#requires -version 3
<#
  launcher.ps1 — WVN NPI & ECN Command Center backend.

  A .NET HttpListener serving the static frontend (index.html / styles.css /
  app.js) and a small JSON API backed entirely by system\config.json and
  system\tracking\*.csv. Every write is a short-lived, exclusively-locked
  file operation triggered by one HTTP request — nothing is held open
  between requests, so multiple users on the same network share can use the
  tool at once without CSV locking crashes.

  There is no workbook reading here. config.json is authored data (product
  families, document types, the NPI/ECN step models); system\tracking\*.csv
  is authored data written by this tool. Both are edited only through the
  API, never scanned from source trackers.
#>
[CmdletBinding()]
param(
  [int]$Port = 8080,
  [switch]$NoBrowser,
  # v11: overrides the COMPUTERNAME_USERNAME journal identity (tests only).
  [string]$WriterId = '',
  # v11: one-time revision backfill. Dry run (report only) unless -Apply.
  [switch]$Backfill,
  [switch]$Apply
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

# PS 5.1 does not load the compression assemblies by default. Several
# endpoints (transfer-package zip, XLSX report generation, the LFI ->
# LL_info.xlsx writer) use [System.IO.Compression.ZipFile]/[ZipArchive]
# without loading these themselves, so they only worked when some other
# endpoint happened to Add-Type them first in the same process. Load both
# once at startup so every endpoint can rely on the types being present
# regardless of request order.
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression
# Needed by Add-XlsxImageAnchors to read a photo's natural pixel size for its
# single-cell OpenXML anchor (v8.3) - oneCellAnchor has no from/to cell box to
# imply a size from, so the real width/height has to come from somewhere.
Add-Type -AssemblyName System.Drawing

# ============================================================ paths & log ==
$SystemDir  = $PSScriptRoot
if (-not $SystemDir) { $SystemDir = Split-Path -Parent $MyInvocation.MyCommand.Path }
$RootDir      = Split-Path -Parent $SystemDir
$ConfigPath   = Join-Path $SystemDir 'config.json'
$TrackingDir  = Join-Path $SystemDir 'tracking'
$TemplatesDir = Join-Path $SystemDir 'templates'
$StagingDir   = Join-Path $SystemDir 'tmp_staging'
$LogDir       = Join-Path $SystemDir 'logs'
# v11: one writer identity per PC + user (see "v11 journal storage"). The log
# is per writer too - on a OneDrive-synced folder one shared log file would
# itself be a conflict generator.
if (-not $WriterId) { $WriterId = [string]$env:COMPUTERNAME + '_' + [string]$env:USERNAME }
$WriterId = ($WriterId -replace '[^A-Za-z0-9_-]', '_')
$LogPath      = Join-Path $LogDir ('launcher_' + $WriterId + '.log')
# Every location the document vault has previously lived in, so a tool folder
# upgraded in place carries its evidence forward instead of stranding it.
$LegacyEvidenceDir       = Join-Path $SystemDir 'evidence'                                   # v2.0
$LegacyEvidenceVaultDir  = Join-Path $RootDir '..\evidence\NPI_EPM_Documents_Control'        # v2.1-v2.4
$LegacyVaultDir          = Join-Path $RootDir '..\NPI_EPM_Documents_Control'                 # v2.5+
try { $LegacyEvidenceVaultDir = [System.IO.Path]::GetFullPath($LegacyEvidenceVaultDir) } catch { $LegacyEvidenceVaultDir = '' }
try { $LegacyVaultDir         = [System.IO.Path]::GetFullPath($LegacyVaultDir)         } catch { $LegacyVaultDir         = '' }
# The live vault sits outside the app folder entirely — resolved from config
# once the file has been read, see "document vault" below.
$EvidenceDir  = $LegacyEvidenceDir

foreach ($d in @($TrackingDir, $TemplatesDir, $LogDir)) {
  if (-not (Test-Path -LiteralPath $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
}

# Crash-proof logging: try the primary log, then a fresh timestamped one,
# then give up quietly. Never let logging itself take the process down.
$script:LogTarget = $LogPath
function Write-Log {
  param([string]$Message, [string]$Level = 'INFO')
  $line = '[{0}] [{1}] {2}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Level, $Message
  try {
    Add-Content -LiteralPath $script:LogTarget -Value $line -Encoding UTF8 -ErrorAction Stop
    return
  } catch { }
  try {
    $fallback = Join-Path $LogDir ('app_fallback_' + (Get-Date -Format 'yyyyMMdd_HHmmss') + '.log')
    Add-Content -LiteralPath $fallback -Value $line -Encoding UTF8 -ErrorAction Stop
    $script:LogTarget = $fallback
    return
  } catch { }
  try { Write-Host $line } catch { }
}

Write-Log ('Starting. Root=' + $RootDir)

# ============================================================ single run ==
$mutex = New-Object System.Threading.Mutex($false, 'Global\WVN_NPI_EPM_StageGate_SingleInstance')
if (-not $mutex.WaitOne(0)) {
  Write-Log 'Another instance is already running — exiting.' 'WARN'
  if (-not $NoBrowser) { Start-Process 'http://localhost:8080/' }
  exit 0
}

# =========================================================== retry lock ==
# Exclusive, short-lived file access with a 3-retry / 100ms backoff — matches
# config.file_system_resilience. Every read-modify-write of a CSV or of
# config.json goes through this so two simultaneous submits never corrupt
# either file; the loser just retries a fraction of a second later.
function Invoke-Locked {
  param(
    [Parameter(Mandatory)][string]$Path,
    [Parameter(Mandatory)][scriptblock]$Action,
    [int]$Retries = 3,
    [int]$DelayMs = 100
  )
  $attempt = 0
  while ($true) {
    $attempt++
    $stream = $null
    try {
      $stream = New-Object System.IO.FileStream($Path, [System.IO.FileMode]::OpenOrCreate, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
      $result = & $Action $stream
      $stream.Close(); $stream = $null
      return $result
    } catch [System.IO.IOException] {
      if ($stream) { try { $stream.Close() } catch { } }
      if ($attempt -gt $Retries) {
        Write-Log ("Lock failed after $Retries retries on $Path : " + $_.Exception.Message) 'ERROR'
        throw
      }
      Start-Sleep -Milliseconds ($DelayMs + (Get-Random -Maximum ($DelayMs + 1)))
    } finally {
      if ($stream) { try { $stream.Close() } catch { } }
    }
  }
}

function Read-AllText { param([System.IO.FileStream]$Stream)
  $Stream.Seek(0, [System.IO.SeekOrigin]::Begin) | Out-Null
  $reader = New-Object System.IO.StreamReader($Stream, [System.Text.Encoding]::UTF8, $true, 4096, $true)
  $text = $reader.ReadToEnd(); $reader.Close(); return $text
}
function Write-AllText { param([System.IO.FileStream]$Stream, [string]$Text)
  $Stream.Seek(0, [System.IO.SeekOrigin]::Begin) | Out-Null
  $Stream.SetLength(0)
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($Text)
  $Stream.Write($bytes, 0, $bytes.Length)
  $Stream.Flush()
}

# ================================================================ config ==
function Get-Config {
  if (-not (Test-Path -LiteralPath $ConfigPath)) { throw "config.json not found at $ConfigPath" }
  Invoke-Locked -Path $ConfigPath -Action { param($s) (Read-AllText $s) | ConvertFrom-Json }
}
function Save-Config { param($ConfigObj)
  # v12.2: a save made by a signed-in person is stamped and copied into the
  # vault (see Save-ConfigSnapshot). The stamp is what tells a fresh app copy
  # still on factory settings apart from one an admin has set up. A save made
  # by the server itself at start-up carries no user and is not stamped.
  $by = [string]$script:ReqUser
  if ($by) {
    $ConfigObj | Add-Member -NotePropertyName settings_saved_utc -NotePropertyValue ([DateTime]::UtcNow.ToString('o')) -Force
    $ConfigObj | Add-Member -NotePropertyName settings_saved_by -NotePropertyValue $by -Force
  }
  $json = $ConfigObj | ConvertTo-Json -Depth 12
  Invoke-Locked -Path $ConfigPath -Action { param($s) Write-AllText $s $json }.GetNewClosure() | Out-Null
  if ($by) { Save-ConfigSnapshot -ConfigObj $ConfigObj -By $by }
}

# ---- deployment path (v11: runtime only) ----------------------------------
# Before v11 this was written back into config.json whenever the tool ran from
# a new location (with a folder picker on first launch). With one app folder
# synced to several PCs, every replica sits at a different path, so each
# launch rewrote the shared config.json - a guaranteed OneDrive conflict. The
# path is now simply where this copy runs: /api/data reports it, nothing stores it.
Write-Log ('Deployment path (runtime): ' + $RootDir + '  writer: ' + $WriterId)

# ---- document vault (v2.1) ------------------------------------------------
# Evidence no longer lives under system\. It sits in a sibling folder of the
# app root — NPI_EPM_Documents_Control by default — so the controlled documents
# survive replacing the tool folder, and so a user can browse them in Explorer
# without wandering into the app's internals.
try {
  $cfg = Get-Config
  $dd = $cfg.deployment_defaults
  $folderName = if ($dd.evidence_vault_folder_name) { [string]$dd.evidence_vault_folder_name } else { 'NPI_EPM_Documents_Control' }
  $relative   = if ($dd.evidence_vault_relative_to_root) { [string]$dd.evidence_vault_relative_to_root } else { '..' }
  $defaultVault = [System.IO.Path]::GetFullPath((Join-Path (Join-Path $RootDir $relative) $folderName))

  # v11: resolved per PC and never written back. The folder name + relative
  # location in config.json are what every PC shares. An absolute
  # evidence_vault_path is honoured only by the one install it was recorded for
  # (pre-v11 single-PC setups); it is never persisted again, because on a
  # synced app folder each PC would overwrite the shared config.json with its
  # own path.
  $vault = $defaultVault
  $configured = [string]$dd.evidence_vault_path
  if ($configured) {
    if (([string]$dd.evidence_vault_root) -eq $RootDir -and (Test-Path -LiteralPath (Split-Path -Parent $configured))) { $vault = $configured }
    else { Write-Log ('Configured vault path ' + $configured + ' belongs to another install - using ' + $defaultVault) 'WARN' }
  }
  if (-not (Test-Path -LiteralPath $vault)) { New-Item -ItemType Directory -Path $vault -Force | Out-Null }
  $EvidenceDir = $vault
  Write-Log ('Document vault: ' + $EvidenceDir)

  # One-time migration out of every location the vault has ever lived in:
  #   v2.0        system\evidence
  #   v2.1-v2.4   ..\evidence\NPI_EPM_Documents_Control
  #   v2.5+       ..\NPI_EPM_Documents_Control
  # Files keep their existing sub-path. Their old folder layout was
  # [DocType]\[Family]\[FG]\[Part]; new files use [Model]\[FG]\[DocType]. Old
  # evidence is deliberately NOT re-shuffled into the new shape — moving files
  # is safe, rewriting a hierarchy underneath recorded paths is not. Both
  # layouts coexist and every stored path stays correct.
  foreach ($legacy in @($LegacyEvidenceDir, $LegacyEvidenceVaultDir, $LegacyVaultDir)) {
    if (-not $legacy) { continue }
    if (-not (Test-Path -LiteralPath $legacy)) { continue }
    if ([System.IO.Path]::GetFullPath($legacy).TrimEnd('\') -eq [System.IO.Path]::GetFullPath($EvidenceDir).TrimEnd('\')) { continue }
    $stale = @(Get-ChildItem -LiteralPath $legacy -Recurse -File -ErrorAction SilentlyContinue |
               Where-Object { $_.Name -ne '.gitkeep' })
    if (-not $stale.Count) { continue }
    Write-Log ('Migrating ' + $stale.Count + ' file(s) from ' + $legacy + ' into the vault.')
    $moved = 0
    foreach ($f in $stale) {
      $rel = $f.FullName.Substring($legacy.Length).TrimStart('\')
      $dest = Join-Path $EvidenceDir $rel
      $destParent = Split-Path -Parent $dest
      if (-not (Test-Path -LiteralPath $destParent)) { New-Item -ItemType Directory -Path $destParent -Force | Out-Null }
      if (Test-Path -LiteralPath $dest) { Write-Log ('  skipped (already in vault): ' + $rel) }
      else { Move-Item -LiteralPath $f.FullName -Destination $dest -Force; $moved++ }
    }
    # lb_deliverables holds absolute paths written before the move; rewrite
    # them so "Copy path" and the exporter keep working on migrated evidence.
    if ($moved) {
      try {
        $delPath = Join-Path $TrackingDir 'lb_deliverables.csv'
        if (Test-Path -LiteralPath $delPath) {
          $from = $legacy; $to = $EvidenceDir
          Invoke-Locked -Path $delPath -Action {
            param($s)
            $t = Read-AllText $s
            if ($t) { Write-AllText $s ($t.Replace($from, $to)) }
          }.GetNewClosure() | Out-Null
        }
      } catch { Write-Log ('Deliverable path rewrite failed: ' + $_.Exception.Message) 'WARN' }
    }
  }
} catch {
  Write-Log ('Vault resolution failed, using ' + $EvidenceDir + ' — ' + $_.Exception.Message) 'ERROR'
  if (-not (Test-Path -LiteralPath $EvidenceDir)) { New-Item -ItemType Directory -Path $EvidenceDir -Force | Out-Null }
}

# ============================================================ CSV stores ==
$Stores = [ordered]@{
  # v2.1 added family_id / target_date at the END on purpose: Read-Store parses
  # positionally, so appending keeps CSVs written by 2.0 readable.
  # v2.4 appended certifications (pipe-separated, e.g. "CB|CE-EMC|PSE"). A comma
  # would have to be quoted on every row; a pipe never collides with a scheme name.
  # v2.7 appended owner_pic / claimed_by / claimed_utc on lb_gates, lb_deliverables,
  # lb_sp_issues and lb_issues so the claim engine can persist task ownership.
  # lb_deliverables also gained custom_doc for model-specific document uploads.
  # v3.6 fixed a naming collision that had stood since v2.1: the column named
  # `family` held the broad product CATEGORY (e.g. CL-CORDLESS) and the column
  # named `family_id` held the actual specific model code (e.g. 9649LP) that
  # every project is really tracked by - the opposite of what a reader would
  # guess from the names, and the reason document filing was landing under the
  # shared category folder instead of the project's own model folder. Renamed
  # in place, same positions: `family` -> `prod_family` (the category),
  # `family_id` -> `family` (the model code - matches the real Item Master's
  # own "Family" column, e.g. Group Family code 9649LP). Also dropped `fg_id`
  # entirely: this app has never tracked individual finished-good/child SKUs,
  # only the Family (model) level, and the column had held nothing but an
  # empty string since v3.5.
  lb_projects     = @('project_id','process','prod_family','class_abcde','prf_date','market_manager','country','customer_number','status','created_by','created_utc','updated_utc','notes','family','target_date','certifications')
  # v3.6 dropped warehouse_ready: dead since the Warehouse readiness tab and
  # its lb_warehouse store were removed - nothing read or wrote it any more.
  # v4.0 appended supporter_pic/supporter_by/supporter_utc (second-claimer,
  # two-tier ownership) and assigned_by/assigned_utc (admin-assigned tasks)
  # to every store the claim engine already touched. No data migration
  # needed: these four stores are all currently empty on disk.
  lb_gates        = @('gate_id','project_id','process','step_key','step_num','step_name','status','complexity','batch_1','batch_2','batch_3','batch_override','batch_justification','approved_by','approved_utc','evidence_cited','notes','updated_utc','owner_pic','claimed_by','claimed_utc','supporter_pic','supporter_by','supporter_utc','assigned_by','assigned_utc','target_week')
  # v2.2 appended kind..link_url. `kind` is 'file' for an uploaded document and
  # 'link' for a UNC path or URL that lives somewhere else and is only cited.
  # v11 appended revision_no, is_active, change_reason, superseded_utc. Only
  # change_reason is authored; the other three are DERIVED on every read (see
  # Set-DerivedRevisions) and written to the base file only by the backfill.
  # v11.1 appended part_id: one document type can need a different file per
  # BOM part (e.g. a DWG per part on a multi-part FG). Set-DerivedRevisions
  # groups by project+step+doc_code+part_id, so two parts filed under the same
  # doc_code are independent "active" slots instead of one superseding the
  # other. Blank (the default for every pre-v11.1 row) means "the one part",
  # which reproduces today's behaviour exactly.
  lb_deliverables = @('deliverable_id','project_id','step_key','doc_code','file_name','file_path','sha256','status','approved','suspect_template','uploaded_by','uploaded_utc','notes','kind','original_name','wvn_id','wnb_id','description','link_url','custom_doc','owner_pic','claimed_by','claimed_utc','supporter_pic','supporter_by','supporter_utc','assigned_by','assigned_utc','target_week','revision_no','is_active','change_reason','superseded_utc','part_id')
  lb_doc_comments = @('comment_id','project_id','deliverable_id','doc_code','step_key','author','comment','created_utc')
  # v2.3 — shared with the standalone WVN_Ticketing_Center, which points at
  # this same tracking folder. lb_ticket_events is append-only by convention:
  # nothing in either app ever updates or deletes a row in it.
  lb_tickets      = @('ticket_id','project_id','step_key','doc_code','title','description','requested_by','requested_dept','requested_utc','assigned_dept','assigned_to','priority','due_date','status','fulfilled_by','fulfilled_utc','deliverable_id','sha256','close_note')
  lb_ticket_events= @('event_id','ticket_id','timestamp_utc','actor','actor_role','action','detail','sha256')
  lb_sp_issues    = @('sp_id','project_id','title','description','raised_by','raised_utc','owner_dept','owner_pic','due_date','status','action_taken','remarks','attachment_name','attachment_path','last_message_by','last_message_utc','last_message','priority','assigned_dept','claimed_by','claimed_utc','supporter_pic','supporter_by','supporter_utc','assigned_by','assigned_utc')
  lb_approvals    = @('approval_id','project_id','step_key','deliverable_id','approved_by','approved_utc','approval_type','evidence_count','comments')
  lb_bypasses     = @('bypass_id','project_id','step_key','authorised_by','authorised_utc','reason','mitigation','supersede_by','closed_utc','closed_note')
  lb_issues       = @('issue_id','project_id','step_key','raised_utc','raised_by','category','description','owner','due_date','status','resolution','closed_utc','owner_pic','claimed_by','claimed_utc','supporter_pic','supporter_by','supporter_utc','assigned_by','assigned_utc','severity','evidence_path')
  lb_ppap         = @('ppap_id','project_id','part_number','customer','doc_code','required','submitted_utc','customer_approved','customer_approved_utc','notes')
  # v3.6 removed lb_d365 entirely: it was genuinely dead, left behind when the
  # D365 entry log tab was cut from Input — nothing ever read TRK.lb_d365.
  # v4.2 removed lb_warehouse for the same reason, one step later. It had been
  # kept only because gateState()/whReady() still read it to decide whether a
  # step with warehouse_gate_required could be approved; warehouse clearance
  # is no longer a gate condition anywhere, so nothing reads or writes it.
  lb_mwer         = @('mwer_id','project_id','step_key','meeting_type','meeting_date','attendees','summary','evidence_file','evidence_body','decision','conditions','logged_by','logged_utc')
  lb_audit        = @('log_id','timestamp_utc','user','action','project_id','object_type','object_id','change_from','change_to','detail','result')
  # v11.1 — a file someone pasted straight into the vault, bypassing the app
  # entirely, is never deleted or moved automatically (see /api/vault/orphans).
  # "Ignore" just means "I looked, it is not a deliverable" and needs to be
  # remembered so the same file does not keep reappearing on the Input tab.
  lb_vault_ignored = @('ignore_id','file_path','ignored_by','ignored_utc','reason')
}
$IdPrefix = @{
  lb_gates='GATE'; lb_deliverables='DEL'; lb_approvals='APR'; lb_bypasses='BYP'; lb_issues='LFI';
  lb_ppap='PPAP'; lb_mwer='MWER'; lb_audit='LOG'; lb_doc_comments='CMT'
  lb_tickets='TKT'; lb_ticket_events='EVT'; lb_sp_issues='SPI'; lb_vault_ignored='IGN'
}

function CsvPath { param([string]$Store) Join-Path $TrackingDir ($Store + '.csv') }

function ConvertTo-CsvCell { param([string]$Value)
  $v = if ($null -eq $Value) { '' } else { [string]$Value }
  $v = $v -replace "`r?`n", ' '
  if ($v -match '[",]') { return '"' + ($v -replace '"', '""') + '"' }
  return $v
}
function ConvertFrom-CsvLine { param([string]$Line)
  $out = New-Object System.Collections.Generic.List[string]
  $f = ''; $q = $false
  for ($i = 0; $i -lt $Line.Length; $i++) {
    $c = $Line[$i]
    if ($q) {
      if ($c -eq '"') { if ($i + 1 -lt $Line.Length -and $Line[$i+1] -eq '"') { $f += '"'; $i++ } else { $q = $false } }
      else { $f += $c }
    } elseif ($c -eq '"') { $q = $true }
    elseif ($c -eq ',') { $out.Add($f); $f = '' }
    else { $f += $c }
  }
  $out.Add($f)
  return ,$out
}

# Full-document CSV reader (v3.1, for /api/projects/batch).
#
# ConvertFrom-CsvLine above is deliberately line-at-a-time because the stores it
# serves never contain embedded newlines - ConvertTo-CsvCell strips them on the
# way in. A file a user hand-edits in Excel has no such guarantee: a "notes"
# cell with Alt+Enter in it becomes a quoted field spanning two physical lines,
# and splitting on newline first would tear that record in half and shift every
# column after it. This walks the whole text once so a newline inside quotes is
# just another character.
#
# Handles: quoted fields, commas and newlines inside quotes, "" escaped quotes,
# CRLF and LF, a trailing newline, and blank lines (skipped).
# Returns a List of List[string] - one entry per record.
function ConvertFrom-CsvText { param([string]$Text)
  $records = New-Object System.Collections.Generic.List[object]
  if ($null -eq $Text) { return ,$records }
  $Text = $Text -replace "^﻿", ''      # strip a UTF-8 BOM if Excel added one
  $row = New-Object System.Collections.Generic.List[string]
  $field = New-Object System.Text.StringBuilder
  $inQuotes = $false
  $i = 0
  $len = $Text.Length
  while ($i -lt $len) {
    $c = $Text[$i]
    if ($inQuotes) {
      if ($c -eq '"') {
        if ($i + 1 -lt $len -and $Text[$i + 1] -eq '"') { [void]$field.Append('"'); $i++ }
        else { $inQuotes = $false }
      } else { [void]$field.Append($c) }
    }
    elseif ($c -eq '"') { $inQuotes = $true }
    elseif ($c -eq ',') { $row.Add($field.ToString()); [void]$field.Clear() }
    elseif ($c -eq "`r") { }                # swallow CR; the LF ends the record
    elseif ($c -eq "`n") {
      $row.Add($field.ToString()); [void]$field.Clear()
      # A record is kept only when it has real content, so a trailing newline
      # and blank separator lines never produce phantom all-empty records.
      if ($row.Count -gt 1 -or ($row.Count -eq 1 -and $row[0] -ne '')) { $records.Add($row) }
      $row = New-Object System.Collections.Generic.List[string]
    }
    else { [void]$field.Append($c) }
    $i++
  }
  # final record, for a file that does not end in a newline
  $row.Add($field.ToString())
  if ($row.Count -gt 1 -or ($row.Count -eq 1 -and $row[0] -ne '')) { $records.Add($row) }
  return ,$records
}

# ==================================================== v11 journal storage ==
# WHY THIS EXISTS. v11 is deployed as ONE app folder inside a SharePoint
# library that the OneDrive client syncs to every user's PC. Each PC runs its
# own instance against its own local replica, so the FileShare.None lock in
# Invoke-Locked only excludes processes on the SAME PC. Two PCs rewriting the
# same CSV between syncs silently lose one side's rows (last writer wins, or
# OneDrive parks one version as 'name-PCNAME.csv').
#
# THE RULE: no file under tracking\ ever has two writers.
#   tracking\<store>.csv                     base snapshot (everything written
#                                            before v11). Never written by the
#                                            running app - only by the offline
#                                            Invoke-V11Backfill.ps1 tool.
#   tracking\journal\<WriterId>\<store>.csv  this PC+user's append-only log of
#                                            row VERSIONS. Only this instance
#                                            writes it (the machine-wide mutex
#                                            stops a second one on the same PC).
# Reads merge the base with every writer's journal - and with any OneDrive
# conflict copy, so even a conflict loses nothing. Versions are applied per
# record id in (_v_utc, _v_writer, _v_seq) order; each version sets only the
# fields named in _v_set ('*' = the whole row), so two people editing
# different fields of one record both keep their change.
#
# Anything the old design enforced with the lock is now either collision-proof
# by construction (IDs carry a per-writer tag; upsert-created records get an
# ID derived from their natural key, so two PCs creating the "same" record
# merge instead of duplicating) or DERIVED on read (revision numbers and the
# one active revision per document - see Set-DerivedRevisions).
#
# The helper signatures below (Read-Store, Add-StoreRow, Set-StoreRow,
# Add-StoreRowsBatch) are unchanged, so no endpoint had to change with it.
$JournalMeta  = @('_v_utc', '_v_writer', '_v_seq', '_v_set')
# v12.2: WHERE the journals live. Before, they sat in the app folder
# (tracking\journal), so replacing the app folder with a newer version - or
# deleting the old one - left the project register, the gate progress and every
# deliverable row behind. They now live in the vault itself:
#   <vault>\_vault\journal\<WriterId>\<store>.csv   this PC+user's journal
#   <vault>\_vault\base\<store>.csv                 copy of a pre-v11 base file
#   <vault>\_vault\config\<WriterId>.json           the settings, last saved here
# Pointing a new app copy at the same vault finds all of it. The old
# tracking\journal is still READ (and copied into the vault once at start-up,
# see Sync-LegacyDataToVault); nothing is written there any more. If the vault
# folder cannot be written to, the app falls back to the old location.
$LegacyJournalRoot = Join-Path $TrackingDir 'journal'
$VaultDataDir   = Join-Path $EvidenceDir '_vault'
$VaultBaseDir   = Join-Path $VaultDataDir 'base'
$VaultConfigDir = Join-Path $VaultDataDir 'config'
$JournalRoot    = Join-Path $VaultDataDir 'journal'
try { New-Item -ItemType Directory -Path $JournalRoot -Force -ErrorAction Stop | Out-Null }
catch {
  Write-Log ('Vault data folder not writable (' + $JournalRoot + ') - project data stays in the app folder: ' + $_.Exception.Message) 'WARN'
  $VaultDataDir = ''; $VaultBaseDir = ''; $VaultConfigDir = ''
  $JournalRoot = $LegacyJournalRoot
}
$MyJournalDir = Join-Path $JournalRoot $WriterId
$SealPath     = Join-Path $LegacyJournalRoot 'BASE_SEALED.txt'
# Legacy journal files whose content is already inside the vault copy; they are
# skipped on read so nothing is parsed twice. Filled by Sync-LegacyDataToVault.
$script:LegacyCovered = @{}
# Short stable tag on sequential IDs: two PCs that pick the same next number
# inside one sync window still mint different IDs (DEL-0082-3FA vs DEL-0082-C07).
$WriterTag = & {
  $h = [System.Security.Cryptography.SHA1]::Create()
  try { ([BitConverter]::ToString($h.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($WriterId)))).Replace('-', '').Substring(0, 3) }
  finally { $h.Dispose() }
}
$script:VSeq = [DateTime]::UtcNow.Ticks
$script:FileCache  = @{}
$script:MergeCache = @{}
$script:PathCache  = @{}
$script:StorageWarnings = [ordered]@{}

# Columns that hold a vault file path. Stored vault-RELATIVE (every PC's
# replica of the vault lives at a different absolute path) and resolved to
# this PC's absolute path on read, so the browser code never sees the change.
$PathColumns = @{ lb_deliverables = @('file_path'); lb_issues = @('evidence_path') }

function Add-StorageWarning { param([string]$Key, [string]$Message)
  if (-not $script:StorageWarnings.Contains($Key)) {
    $script:StorageWarnings[$Key] = $Message
    Write-Log ('STORAGE: ' + $Message + ' [' + $Key + ']') 'WARN'
  }
}

# Shared-read open: never blocks OneDrive (or another reader) and retries the
# brief window where OneDrive itself holds the file while swapping in a newer
# copy from another PC.
function Read-SharedText { param([string]$Path)
  $attempt = 0
  while ($true) {
    $attempt++
    try {
      $fs = New-Object System.IO.FileStream($Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, ([System.IO.FileShare]::ReadWrite -bor [System.IO.FileShare]::Delete))
      try {
        $sr = New-Object System.IO.StreamReader($fs, [System.Text.Encoding]::UTF8, $true)
        return $sr.ReadToEnd()
      } finally { $fs.Close() }
    }
    catch [System.IO.FileNotFoundException] { return '' }
    catch [System.IO.DirectoryNotFoundException] { return '' }
    catch [System.IO.IOException] {
      if ($attempt -ge 8) { throw }
      Start-Sleep -Milliseconds (40 * $attempt)
    }
  }
}

# Parsed CSV, cached on (length, last write) - a 15 s poll from five browsers
# re-parses only the files that actually changed since the last one.
function Get-ParsedCsv { param([string]$Path)
  $fi = New-Object System.IO.FileInfo($Path)
  if (-not $fi.Exists) { return $null }
  $stamp = [string]$fi.Length + '|' + [string]$fi.LastWriteTimeUtc.Ticks
  $hit = $script:FileCache[$Path]
  if ($hit -and $hit.stamp -eq $stamp) { return $hit }
  $text = Read-SharedText $Path
  $lines = @(if ($text) { $text -split "`r?`n" | Where-Object { $_ -ne '' } })
  $header = @()
  if ($lines.Count) { $header = [string[]](ConvertFrom-CsvLine ($lines[0] -replace '^﻿', '')) }
  $rows = New-Object System.Collections.Generic.List[object]
  for ($i = 1; $i -lt $lines.Count; $i++) { $rows.Add([string[]](ConvertFrom-CsvLine $lines[$i])) }
  $entry = @{ stamp = $stamp; header = $header; rows = $rows }
  $script:FileCache[$Path] = $entry
  return $entry
}

# Every file that contributes to a store: the base file first, then base
# conflict copies, then each writer's journal (plus its conflict copies).
function Get-StoreFiles { param([string]$Store)
  $rx = '^' + [regex]::Escape($Store) + '(\.\d+)?(-.+)?\.csv$'
  $base = New-Object System.Collections.Generic.List[string]
  $extraBase = New-Object System.Collections.Generic.List[string]
  $journals = New-Object System.Collections.Generic.List[string]
  if (Test-Path -LiteralPath $TrackingDir) {
    foreach ($f in [System.IO.Directory]::GetFiles($TrackingDir, $Store + '*.csv')) {
      $n = [System.IO.Path]::GetFileName($f)
      if ($n -eq ($Store + '.csv')) { $base.Add($f) }
      elseif ($n -match $rx) {
        $extraBase.Add($f)
        Add-StorageWarning $f ('OneDrive conflict copy ' + $n + ' in tracking\. Its rows are merged, so nothing is lost - but it means an app older than v11 wrote to tracking\ directly. Make sure every PC runs v11.')
      }
    }
  }
  # v12.2: the base copy kept in the vault. With an app folder that has no base
  # file of its own (a fresh install on an existing vault) it IS the base.
  if ($VaultBaseDir) {
    $vb = Join-Path $VaultBaseDir ($Store + '.csv')
    if (Test-Path -LiteralPath $vb -PathType Leaf) { $extraBase.Add($vb) }
  }
  foreach ($f in $extraBase) { $base.Add($f) }
  $roots = @($JournalRoot)
  if ($LegacyJournalRoot -ne $JournalRoot) { $roots += $LegacyJournalRoot }
  foreach ($root in $roots) {
    if (-not (Test-Path -LiteralPath $root)) { continue }
    foreach ($d in [System.IO.Directory]::GetDirectories($root)) {
      foreach ($f in [System.IO.Directory]::GetFiles($d, $Store + '*.csv')) {
        $n = [System.IO.Path]::GetFileName($f)
        if ($n -match $rx) {
          # an old-location journal already copied into the vault is not read twice
          if ($root -ne $JournalRoot -and $script:LegacyCovered.ContainsKey($f.ToLowerInvariant())) { continue }
          $journals.Add($f)
          if ($Matches[2]) {
            Add-StorageWarning $f ('OneDrive conflict copy of a journal (' + $f.Substring($root.Length).TrimStart('\') + '). Merged - nothing lost. It usually means the same Windows user on the same PC name ran the app from two copies at once.')
          }
        }
      }
    }
  }
  return @{ base = $base; journals = $journals }
}

# The merged state of one store. Returns @{ list; byId; lastV; cols } where
# list keeps record order (base rows in file order, then new records in the
# order they were first written). Callers must treat it as read-only - it is
# cached until any contributing file changes.
function Get-MergedStore { param([string]$Store)
  $cols = $Stores[$Store]
  $idCol = $cols[0]
  $files = Get-StoreFiles $Store
  $sig = New-Object System.Text.StringBuilder
  foreach ($f in @($files.base) + @($files.journals)) {
    $fi = New-Object System.IO.FileInfo($f)
    if ($fi.Exists) { [void]$sig.Append($f + '|' + $fi.Length + '|' + $fi.LastWriteTimeUtc.Ticks + ';') }
  }
  $sigText = $sig.ToString()
  $hit = $script:MergeCache[$Store]
  if ($hit -and $hit.sig -eq $sigText) { return $hit.merged }

  $list = New-Object System.Collections.Generic.List[object]
  $byId = @{}
  $lastV = @{}
  $primary = $true
  foreach ($f in $files.base) {
    $p = Get-ParsedCsv $f
    if (-not $p) { $primary = $false; continue }
    foreach ($vals in $p.rows) {
      $o = @{}
      for ($c = 0; $c -lt $cols.Count; $c++) { $o[$cols[$c]] = if ($c -lt $vals.Count) { $vals[$c] } else { '' } }
      $id = [string]$o[$idCol]
      # A base conflict copy repeats most rows; only rows it alone holds count.
      if (-not $primary -and $id -and $byId.ContainsKey($id)) { continue }
      $list.Add($o)
      if ($id -and -not $byId.ContainsKey($id)) { $byId[$id] = $o }
    }
    $primary = $false
  }

  $versions = New-Object System.Collections.Generic.List[object]
  foreach ($f in $files.journals) {
    $p = Get-ParsedCsv $f
    if (-not $p -or -not $p.header.Count) { continue }
    # Journals are read by their OWN header, not positionally: a journal
    # written before a column was appended to $Stores still lines up.
    $ix = @{}
    for ($c = 0; $c -lt $p.header.Count; $c++) { $ix[$p.header[$c]] = $c }
    if (-not $ix.ContainsKey('_v_utc') -or -not $ix.ContainsKey($idCol)) { continue }
    foreach ($vals in $p.rows) {
      $v = @{}
      foreach ($k in $ix.Keys) { $i = $ix[$k]; $v[$k] = if ($i -lt $vals.Count) { $vals[$i] } else { '' } }
      $v['__key'] = [string]$v['_v_utc'] + '|' + [string]$v['_v_writer'] + '|' + ([string]$v['_v_seq']).PadLeft(20, '0')
      $versions.Add($v)
    }
  }
  if ($versions.Count) {
    # Sort a string[] of 'key|index' and walk the indexes. NOT
    # [Array]::Sort($keys, $items, ...): PowerShell binds the generic
    # Sort<TKey,TValue> overload, converts $items into a NEW typed array,
    # sorts that copy and discards it - the keys come back sorted while the
    # items stay in file order (verified on PS 5.1), which silently breaks
    # last-writer-wins.
    $arr = $versions.ToArray()
    $keys = New-Object 'string[]' $arr.Length
    for ($i = 0; $i -lt $arr.Length; $i++) { $keys[$i] = [string]$arr[$i]['__key'] + '|' + $i.ToString('D9') }
    [Array]::Sort($keys, [StringComparer]::Ordinal)
    foreach ($sk in $keys) {
      $v = $arr[[int]$sk.Substring($sk.Length - 9)]
      $id = [string]$v[$idCol]
      if (-not $id) { continue }
      $set = [string]$v['_v_set']
      $fields = if ($set -eq '*' -or -not $set) { $cols } elseif ($set -eq '-') { @() } else { $set.Split(';') }
      $o = $byId[$id]
      if (-not $o) {
        $o = @{}
        foreach ($c in $cols) { $o[$c] = '' }
        $o[$idCol] = $id
        $list.Add($o); $byId[$id] = $o
      }
      # Unknown fields (a newer app's columns) are ignored rather than
      # invented; the id column is identity and never rewritten.
      foreach ($fld in $fields) {
        if ($fld -and $fld -ne $idCol -and $v.ContainsKey($fld) -and $o.ContainsKey($fld)) { $o[$fld] = [string]$v[$fld] }
      }
      $lastV[$id] = [string]$v['__key']
    }
  }
  $merged = @{ list = $list; byId = $byId; lastV = $lastV; cols = $cols }
  $script:MergeCache[$Store] = @{ sig = $sigText; merged = $merged }
  return $merged
}

# Appends versions to THIS writer's journal for a store, in one locked write.
# The lock here is only against OneDrive briefly holding the file mid-upload
# (nobody else ever writes it), hence the wider, jittered retry budget.
function Add-JournalVersions { param([string]$Store, [object[]]$Versions)
  if (-not $Versions -or -not $Versions.Count) { return }
  if ($Store -ne 'lb_audit') { $script:InfoDirty = $true }   # see Update-InfoWorkbook
  if (-not (Test-Path -LiteralPath $MyJournalDir)) { New-Item -ItemType Directory -Path $MyJournalDir -Force | Out-Null }
  $jcols = @($Stores[$Store]) + $JournalMeta
  $headerLine = $jcols -join ','
  # A journal started under an older $Stores layout keeps its own header;
  # new versions go to a sibling named for the new column count, so no line
  # is ever parsed against the wrong header.
  $path = Join-Path $MyJournalDir ($Store + '.csv')
  if (Test-Path -LiteralPath $path) {
    $p = Get-ParsedCsv $path
    if ($p -and $p.header.Count -and (($p.header -join ',') -ne $headerLine)) { $path = Join-Path $MyJournalDir ($Store + '.' + $jcols.Count + '.csv') }
  }
  $sb = New-Object System.Text.StringBuilder
  foreach ($v in $Versions) {
    $cells = foreach ($c in $jcols) { ConvertTo-CsvCell ([string]$v[$c]) }
    [void]$sb.Append(($cells -join ',')); [void]$sb.Append("`r`n")
  }
  $body = $sb.ToString()
  Invoke-Locked -Path $path -Retries 8 -DelayMs 75 -Action {
    param($s)
    $prefix = ''
    if ($s.Length -eq 0) { $prefix = $headerLine + "`r`n" }
    else {
      # Never glue a new line onto a torn last line.
      $s.Seek(-1, [System.IO.SeekOrigin]::End) | Out-Null
      if ($s.ReadByte() -ne 10) { $prefix = "`r`n" }
    }
    $s.Seek(0, [System.IO.SeekOrigin]::End) | Out-Null
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($prefix + $body)
    $s.Write($bytes, 0, $bytes.Length)
    $s.Flush()
  }.GetNewClosure() | Out-Null
}

# The _v_set for a NEW record: only the fields it actually carries. A creation
# has no intent to blank anything, so when two PCs create the same record
# offline (same natural-key ID) both sides' values survive the merge instead
# of the later one wiping the earlier one's fields with empty strings.
function Get-InsertSet { param([hashtable]$Full, [string]$IdCol)
  $names = @($Full.Keys | Where-Object { $_ -ne $IdCol -and [string]$Full[$_] -ne '' } | Sort-Object)
  if (-not $names.Count) { return '-' }
  return ($names -join ';')
}

# One version row. -After is the record's newest version key: the new
# version's timestamp is bumped past it, so an edit made by a PC whose clock
# runs slow still sorts after the version it was made on top of.
function New-VersionRow { param([hashtable]$Values, [string]$Set, [string]$After)
  $script:VSeq++
  $now = [DateTime]::UtcNow
  if ($After) {
    try {
      $prev = [DateTime]::Parse($After.Split('|')[0], [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::RoundtripKind).ToUniversalTime()
      if ($prev -ge $now) { $now = $prev.AddTicks(1) }
    } catch { }
  }
  $v = @{}
  foreach ($k in $Values.Keys) { $v[$k] = $Values[$k] }
  $v['_v_utc']    = $now.ToString('yyyy-MM-ddTHH:mm:ss.fffffffZ', [System.Globalization.CultureInfo]::InvariantCulture)
  $v['_v_writer'] = $WriterId
  $v['_v_seq']    = [string]$script:VSeq
  $v['_v_set']    = $Set
  return $v
}

function ConvertTo-StoredPath { param([string]$Value)
  if (-not $Value) { return $Value }
  if ($Value -match '^[a-zA-Z][a-zA-Z0-9+.-]*://') { return $Value }
  try {
    if (-not [System.IO.Path]::IsPathRooted($Value)) { return $Value }
    $full = [System.IO.Path]::GetFullPath($Value)
    $vault = [System.IO.Path]::GetFullPath($EvidenceDir).TrimEnd('\') + '\'
    if ($full.StartsWith($vault, [StringComparison]::OrdinalIgnoreCase)) { return $full.Substring($vault.Length) }
  } catch { }
  return $Value
}
# Relative -> this PC's vault. An absolute path from another PC's replica (or
# from before v11) that does not exist here is re-rooted at the vault folder
# name, so 'Open in Explorer' and the transfer ZIP work on every PC.
function ConvertFrom-StoredPath { param([string]$Value)
  if (-not $Value) { return $Value }
  if ($Value -match '^[a-zA-Z][a-zA-Z0-9+.-]*://') { return $Value }
  if ($script:PathCache.ContainsKey($Value)) { return $script:PathCache[$Value] }
  $out = $Value
  try {
    if (-not [System.IO.Path]::IsPathRooted($Value)) { $out = Join-Path $EvidenceDir $Value }
    elseif (-not (Test-Path -LiteralPath $Value)) {
      $seg = '\' + (Split-Path -Leaf $EvidenceDir) + '\'
      $i = $Value.IndexOf($seg, [StringComparison]::OrdinalIgnoreCase)
      if ($i -ge 0) {
        $alt = Join-Path $EvidenceDir $Value.Substring($i + $seg.Length)
        if (Test-Path -LiteralPath $alt) { $out = $alt }
      }
    }
  } catch { }
  $script:PathCache[$Value] = $out
  return $out
}
function ConvertTo-StoredRow { param([string]$Store, [hashtable]$Row)
  $out = @{}
  foreach ($k in $Row.Keys) { $out[$k] = $Row[$k] }
  $pcols = $PathColumns[$Store]
  if ($pcols) { foreach ($pc in $pcols) { if ($out.ContainsKey($pc)) { $out[$pc] = ConvertTo-StoredPath ([string]$out[$pc]) } } }
  return $out
}

# R1 - revision history, DERIVED rather than stored-and-flipped. A revision is
# a row that carries evidence (a file, a path or a link): exactly the test
# evidenceFor() has always applied. Claim / custom-doc / Removed marker rows
# are the document's task record, not revisions, and never get a number.
# Order is record order (the order the rows were written), which is exactly
# what evidenceFor()'s "last row wins" used, so day one shows no change.
# Because is_active is computed, "exactly one active revision per document"
# holds by construction however OneDrive interleaves two PCs' uploads.
function Set-DerivedRevisions { param($Rows)
  $groups = New-Object 'System.Collections.Generic.Dictionary[string,object]' ([StringComparer]::Ordinal)
  $order = New-Object System.Collections.Generic.List[string]
  foreach ($r in $Rows) {
    if (-not ($r.file_name -or $r.link_url -or $r.file_path)) {
      $r.revision_no = ''; $r.is_active = ''; $r.superseded_utc = ''
      continue
    }
    # v11.1: part_id joins the key so two BOM parts filed under the same
    # doc_code are two independent revision chains, each with its own active
    # row - not one superseding the other. Blank part_id (every row before
    # v11.1, and every doc that only ever has one file) behaves exactly as
    # before: one chain, one active revision.
    $k = [string]$r.project_id + '|' + [string]$r.step_key + '|' + [string]$r.doc_code + '|' + [string]$r.part_id
    if (-not $groups.ContainsKey($k)) { $groups[$k] = New-Object System.Collections.Generic.List[object]; $order.Add($k) }
    $groups[$k].Add($r)
  }
  foreach ($k in $order) {
    $g = $groups[$k]
    for ($i = 0; $i -lt $g.Count; $i++) {
      $g[$i].revision_no = [string]($i + 1)
      if ($i -eq $g.Count - 1) { $g[$i].is_active = 'YES'; $g[$i].superseded_utc = '' }
      else { $g[$i].is_active = 'NO'; $g[$i].superseded_utc = [string]$g[$i + 1].uploaded_utc }
    }
  }
}

# Reads a store as the merged view (same return shape as before v11).
function Read-Store { param([string]$Store)
  $m = Get-MergedStore $Store
  $cols = $m.cols
  $pcols = $PathColumns[$Store]
  $rows = New-Object System.Collections.Generic.List[object]
  foreach ($o in $m.list) {
    $x = [ordered]@{}
    foreach ($c in $cols) { $x[$c] = $o[$c] }
    if ($pcols) { foreach ($pc in $pcols) { $x[$pc] = ConvertFrom-StoredPath ([string]$x[$pc]) } }
    $rows.Add([pscustomobject]$x)
  }
  if ($Store -eq 'lb_deliverables') { Set-DerivedRevisions $rows }
  # Emitted element by element, exactly as the pre-v11 Read-Store's rows came
  # out of Invoke-Locked: callers wrap in @() and a list emitted as ONE object
  # would serialise as {"value":[...],"Count":n} under PS 5.1 ConvertTo-Json.
  return $rows.ToArray()
}

function New-StoreId {
  param($Merged, [string]$Store, [string]$IdField, [string]$PrefixOverride, [string]$Candidate, [hashtable]$Extra)
  $taken = @{}
  foreach ($o in $Merged.list) { $v = [string]$o[$IdField]; if ($v) { $taken[$v] = $true } }
  if ($Extra) { foreach ($k in $Extra.Keys) { $taken[$k] = $true } }
  if ($Candidate) {
    # A human ID (NPI-9649LP). If two PCs register the same family inside one
    # sync window they mint the same ID and their rows merge into ONE project -
    # which is what both people meant. Locally-visible clashes still get -2.
    $try = $Candidate; $n = 1
    while ($taken.ContainsKey($try)) { $n++; $try = $Candidate + '-' + $n }
    return $try
  }
  $prefix = if ($PrefixOverride) { $PrefixOverride } else { $IdPrefix[$Store] }
  $max = 0
  $rx = '^' + [regex]::Escape($prefix + '-') + '(\d+)(-[0-9A-Fa-f]{3})?$'
  foreach ($k in $taken.Keys) { if ($k -match $rx) { $n = [int]$Matches[1]; if ($n -gt $max) { $max = $n } } }
  return ('{0}-{1:D4}-{2}' -f $prefix, ($max + 1), $WriterTag)
}

# ID for a record Set-StoreRow creates because nothing matched its key: a hash
# of the natural key, so two PCs that both create "the gate row for step 3"
# inside one sync window write versions of ONE record rather than two.
function Get-KeyId { param($Merged, [string]$Store, [string]$IdField, [string[]]$KeyFields, [hashtable]$Row)
  $keyText = $Store + '|' + (($KeyFields | ForEach-Object { ([string]$Row[$_]).ToUpperInvariant() }) -join '|')
  $h = [System.Security.Cryptography.SHA1]::Create()
  try { $hex = ([BitConverter]::ToString($h.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($keyText)))).Replace('-', '').Substring(0, 10) }
  finally { $h.Dispose() }
  $id = $IdPrefix[$Store] + '-K' + $hex
  # Only if that ID already belongs to a record with a DIFFERENT key (its key
  # was later edited) fall back to an ordinary new ID.
  if ($Merged.byId.ContainsKey($id)) { return (New-StoreId -Merged $Merged -Store $Store -IdField $IdField) }
  return $id
}

function Add-StoreRowsBatch {
  param([string]$Store, [object[]]$Rows, [string]$IdField, [hashtable]$IdCandidates)
  $cols = $Stores[$Store]
  $m = Get-MergedStore $Store
  $extra = @{}
  $assigned = @()
  $versions = New-Object System.Collections.Generic.List[object]
  foreach ($row in $Rows) {
    $cand = ''
    if ($IdCandidates) { $cand = [string]$IdCandidates[[string]$row['__key']] }
    $id = [string]$row[$IdField]
    if (-not $id) { $id = New-StoreId -Merged $m -Store $Store -IdField $IdField -Candidate $cand -Extra $extra }
    $extra[$id] = $true
    $row[$IdField] = $id
    $assigned += $id
    $full = @{}
    foreach ($c in $cols) { $full[$c] = if ($row.ContainsKey($c) -and $null -ne $row[$c]) { [string]$row[$c] } else { '' } }
    $versions.Add((New-VersionRow -Values (ConvertTo-StoredRow $Store $full) -Set (Get-InsertSet $full $cols[0])))
  }
  Add-JournalVersions -Store $Store -Versions $versions.ToArray()
  # Enumerated, like the pre-v11 version (it unrolled once through Invoke-Locked).
  return $assigned
}

# Appends one record. $IdCandidate keeps a human-meaningful ID; otherwise a
# sequential writer-tagged one is minted.
function Add-StoreRow {
  param([string]$Store, [hashtable]$Row, [string]$IdField, [string]$IdPrefixOverride, [string]$IdCandidate)
  $cols = $Stores[$Store]
  $m = Get-MergedStore $Store
  if ($IdField -and -not $Row[$IdField]) {
    $Row[$IdField] = New-StoreId -Merged $m -Store $Store -IdField $IdField -PrefixOverride $IdPrefixOverride -Candidate $IdCandidate
  }
  $full = @{}
  foreach ($c in $cols) { $full[$c] = if ($Row.ContainsKey($c) -and $null -ne $Row[$c]) { [string]$Row[$c] } else { '' } }
  Add-JournalVersions -Store $Store -Versions @(New-VersionRow -Values (ConvertTo-StoredRow $Store $full) -Set (Get-InsertSet $full $cols[0]))
  return [pscustomobject]$full
}

# Upsert by key: the FIRST record (in record order) whose key fields all match
# gets a version carrying only the fields supplied; no match creates a record.
# Matching stays case-insensitive, as it always was (-ne on strings).
function Set-StoreRow {
  param([string]$Store, [hashtable]$Row, [string[]]$KeyFields, [string]$IdField)
  $cols = $Stores[$Store]
  $idCol = $cols[0]
  $m = Get-MergedStore $Store
  $match = $null
  foreach ($o in $m.list) {
    $ok = $true
    foreach ($k in $KeyFields) { if ([string]$o[$k] -ne [string]$Row[$k]) { $ok = $false; break } }
    if ($ok -and [string]$o[$idCol]) { $match = $o; break }
  }
  if ($match) {
    $id = [string]$match[$idCol]
    $vals = @{}
    $vals[$idCol] = $id
    $set = New-Object System.Collections.Generic.List[string]
    foreach ($c in $cols) {
      if ($c -ne $idCol -and $Row.ContainsKey($c) -and $null -ne $Row[$c]) { $set.Add($c); $vals[$c] = [string]$Row[$c] }
    }
    $full = @{}
    foreach ($c in $cols) { $full[$c] = [string]$match[$c] }
    foreach ($c in $set) { $full[$c] = $vals[$c] }
    if ($set.Count) {
      Add-JournalVersions -Store $Store -Versions @(New-VersionRow -Values (ConvertTo-StoredRow $Store $vals) -Set ($set -join ';') -After ([string]$m.lastV[$id]))
    }
    $pcols = $PathColumns[$Store]
    if ($pcols) { foreach ($pc in $pcols) { $full[$pc] = ConvertFrom-StoredPath ([string]$full[$pc]) } }
    return [pscustomobject]$full
  }
  if ($IdField -and -not $Row[$IdField]) {
    if ($KeyFields -contains $IdField) { $Row[$IdField] = New-StoreId -Merged $m -Store $Store -IdField $IdField }
    else { $Row[$IdField] = Get-KeyId -Merged $m -Store $Store -IdField $IdField -KeyFields $KeyFields -Row $Row }
  }
  $full = @{}
  foreach ($c in $cols) { $full[$c] = if ($Row.ContainsKey($c) -and $null -ne $Row[$c]) { [string]$Row[$c] } else { '' } }
  Add-JournalVersions -Store $Store -Versions @(New-VersionRow -Values (ConvertTo-StoredRow $Store $full) -Set (Get-InsertSet $full $cols[0]))
  return [pscustomobject]$full
}

# Startup storage checks: seal the base snapshot the first time v11 runs, and
# warn loudly if an older app has written to tracking\ since (it would bypass
# the journal and, on OneDrive, overwrite other PCs' base rows).
function Test-StorageHealth {
  try {
    if (-not (Test-Path -LiteralPath $LegacyJournalRoot)) { New-Item -ItemType Directory -Path $LegacyJournalRoot -Force | Out-Null }
    if (-not (Test-Path -LiteralPath $SealPath)) {
      Set-Content -LiteralPath $SealPath -Value ([DateTime]::UtcNow.ToString('o')) -Encoding ASCII
      Write-Log 'Sealed the v11 base snapshot (tracking\journal\BASE_SEALED.txt).'
    }
    $seal = [DateTime]::Parse((Get-Content -LiteralPath $SealPath -TotalCount 1), [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::RoundtripKind).ToUniversalTime()
    foreach ($store in $Stores.Keys) {
      $bp = Join-Path $TrackingDir ($store + '.csv')
      if ((Test-Path -LiteralPath $bp) -and ((Get-Item -LiteralPath $bp).LastWriteTimeUtc -gt $seal.AddMinutes(2))) {
        Add-StorageWarning $bp ('tracking\' + $store + '.csv was modified after the v11 upgrade. Its rows are still read, but only a pre-v11 app (or a hand edit) writes there - check every PC runs v11.')
      }
    }
    foreach ($f in @(Get-ChildItem -LiteralPath $SystemDir -Filter 'config-*.json' -ErrorAction SilentlyContinue)) {
      Add-StorageWarning $f.FullName ('OneDrive conflict copy ' + $f.Name + ': two admins changed Settings at the same time. One change is in config.json, the other only in this file - compare them and re-apply the missing edit.')
    }
  } catch { Write-Log ('Storage health check failed: ' + $_.Exception.Message) 'WARN' }
}

Test-StorageHealth

# ================================================ v12.2 project data in the vault ==
# See "WHERE the journals live" above. Three jobs:
#   1. Sync-LegacyDataToVault   copy the journals / base files an older app left
#                               in tracking\ into the vault, once, byte-exact.
#   2. Save-ConfigSnapshot      keep the admin's settings (processes, document
#                               types, folder structure ...) in the vault too.
#   3. Get-VaultDataStatus      what the vault holds, for Settings.
# None of it ever deletes anything in the old location.
function Read-BytesShared { param([string]$Path)
  $fs = New-Object System.IO.FileStream($Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, ([System.IO.FileShare]::ReadWrite -bor [System.IO.FileShare]::Delete))
  try {
    $b = New-Object byte[] ([int]$fs.Length)
    $n = 0
    while ($n -lt $b.Length) { $r = $fs.Read($b, $n, $b.Length - $n); if ($r -le 0) { break }; $n += $r }
    return ,$b
  } finally { $fs.Close() }
}
# $true when $Big starts with every byte of $Small
function Test-BytesPrefix { param([byte[]]$Small, [byte[]]$Big)
  if ($Small.Length -gt $Big.Length) { return $false }
  if ($Small.Length -eq 0) { return $true }
  $h = [System.Security.Cryptography.SHA256]::Create()
  try {
    $a = [BitConverter]::ToString($h.ComputeHash($Small, 0, $Small.Length))
    $b = [BitConverter]::ToString($h.ComputeHash($Big, 0, $Small.Length))
  } finally { $h.Dispose() }
  return ($a -eq $b)
}
# 'copied'    the vault now holds the file (new, or its older prefix replaced)
# 'covered'   the vault copy already contains the whole old file
# 'diverged'  both carry rows the other lacks - both stay, both are read
# 'failed'    could not read or write (OneDrive busy, permissions)
function Copy-LegacyIntoVault { param([string]$Src, [string]$Dest, [switch]$KeepExisting)
  try {
    $destDir = Split-Path -Parent $Dest
    if (-not (Test-Path -LiteralPath $destDir)) { New-Item -ItemType Directory -Path $destDir -Force | Out-Null }
    $sb = Read-BytesShared $Src
    if (-not (Test-Path -LiteralPath $Dest -PathType Leaf)) { [System.IO.File]::WriteAllBytes($Dest, $sb); return 'copied' }
    $db = Read-BytesShared $Dest
    if (Test-BytesPrefix $sb $db) { return 'covered' }
    if ((-not $KeepExisting) -and (Test-BytesPrefix $db $sb)) { [System.IO.File]::WriteAllBytes($Dest, $sb); return 'copied' }
    return 'diverged'
  } catch {
    Write-Log ('Copy into vault failed for ' + $Src + ': ' + $_.Exception.Message) 'WARN'
    return 'failed'
  }
}
function Sync-LegacyDataToVault {
  if (-not $VaultDataDir -or $JournalRoot -eq $LegacyJournalRoot) { return }
  $n = @{ copied = 0; covered = 0; diverged = 0; failed = 0 }
  try {
    if (Test-Path -LiteralPath $LegacyJournalRoot) {
      foreach ($d in [System.IO.Directory]::GetDirectories($LegacyJournalRoot)) {
        $name = [System.IO.Path]::GetFileName($d)
        foreach ($f in [System.IO.Directory]::GetFiles($d, '*.csv')) {
          $r = Copy-LegacyIntoVault -Src $f -Dest (Join-Path (Join-Path $JournalRoot $name) ([System.IO.Path]::GetFileName($f)))
          $n[$r]++
          if ($r -eq 'copied' -or $r -eq 'covered') { $script:LegacyCovered[$f.ToLowerInvariant()] = $true }
        }
      }
    }
    foreach ($store in $Stores.Keys) {
      $bp = Join-Path $TrackingDir ($store + '.csv')
      if (Test-Path -LiteralPath $bp -PathType Leaf) {
        $r = Copy-LegacyIntoVault -Src $bp -Dest (Join-Path $VaultBaseDir ($store + '.csv')) -KeepExisting
        $n[$r]++
      }
    }
  } catch { Write-Log ('Syncing old project data into the vault failed: ' + $_.Exception.Message) 'WARN' }
  Write-Log ('Project data in the vault (' + $VaultDataDir + '): ' + $n.copied + ' file(s) copied from the app folder, ' + $n.covered + ' already there, ' + $n.diverged + ' read from both places, ' + $n.failed + ' failed.')
  # A marker so the folder explains itself to anyone browsing the vault.
  try {
    $note = Join-Path $VaultDataDir 'README.txt'
    if (-not (Test-Path -LiteralPath $note)) {
      Set-Content -LiteralPath $note -Encoding UTF8 -Value @(
        'WVN Stage Gate Command Center - project data of this vault',
        '',
        'journal\<PC_user>\*.csv   project register, gate progress, deliverables, approvals, issues, audit log',
        'base\*.csv               copy of the data a pre-v11 app kept in its own folder',
        'config\<PC_user>.json    the admin settings (processes, document types, folder structure ...)',
        '..\Project_Information.xlsx   the same information as an Excel file anyone can open and read',
        '                         (rewritten by the app after every change - read-only copy)',
        '',
        'Do not edit or delete these files. A newer copy of the app pointed at this vault folder',
        '(Settings > Evidence vault location) picks all of this up again, so the app folder itself',
        'can be replaced or removed without losing the project information.')
    }
  } catch { }
}
Sync-LegacyDataToVault

# ---- settings snapshot ----
function Write-ConfigSnapshotFile { param($ConfigObj, [string]$By)
  $ver = ''
  try { $ver = [string]$ConfigObj.system_info.version } catch { }
  # The old plain-text admin PIN (pre-v12 configs) must never be copied into a
  # folder every user of the vault can read.
  if ($ConfigObj.PSObject.Properties.Name -contains 'admin_pin') {
    $ConfigObj = ($ConfigObj | ConvertTo-Json -Depth 14) | ConvertFrom-Json
    $ConfigObj.PSObject.Properties.Remove('admin_pin')
  }
  $snap = [ordered]@{
    saved_utc = [DateTime]::UtcNow.ToString('o'); writer = $WriterId; by = $By
    app_version = $ver; config = $ConfigObj
  }
  Write-JsonFile -Path (Join-Path $VaultConfigDir ($WriterId + '.json')) -Object $snap
}
function Save-ConfigSnapshot { param($ConfigObj, [string]$By = '')
  if (-not $VaultConfigDir) { return }
  try { Write-ConfigSnapshotFile -ConfigObj $ConfigObj -By $By }
  catch { Write-Log ('Settings snapshot into the vault failed: ' + $_.Exception.Message) 'WARN' }
}
function Get-ConfigSnapshots {
  $out = New-Object System.Collections.Generic.List[object]
  if (-not $VaultConfigDir -or -not (Test-Path -LiteralPath $VaultConfigDir)) { return $out.ToArray() }
  foreach ($f in [System.IO.Directory]::GetFiles($VaultConfigDir, '*.json')) {
    try {
      $s = Read-JsonFile $f
      if ($s -and $s.config -and $s.saved_utc) {
        $out.Add(@{ file = $f; writer = [string]$s.writer; by = [string]$s.by; saved_utc = [string]$s.saved_utc; app_version = [string]$s.app_version; config = $s.config })
      }
    } catch { Write-Log ('Settings snapshot unreadable: ' + $f + ' - ' + $_.Exception.Message) 'WARN' }
  }
  return $out.ToArray()
}
# The settings that matter, without what is per PC, per copy of the app or just
# a stamp: two configs with the same fingerprint are the same setup.
function Get-ConfigFingerprint { param($Config)
  $c = ($Config | ConvertTo-Json -Depth 14) | ConvertFrom-Json
  foreach ($k in 'settings_saved_utc', 'settings_saved_by', 'admin_pin') { $c.PSObject.Properties.Remove($k) }
  if ($c.system_info) { foreach ($k in 'version', 'deployment_path') { $c.system_info.PSObject.Properties.Remove($k) } }
  if ($c.deployment_defaults) {
    foreach ($k in 'evidence_vault_path', 'evidence_vault_root', 'evidence_vault_folder_name', 'evidence_vault_relative_to_root') { $c.deployment_defaults.PSObject.Properties.Remove($k) }
  }
  $h = [System.Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($h.ComputeHash([System.Text.Encoding]::UTF8.GetBytes(($c | ConvertTo-Json -Depth 14 -Compress))))).Replace('-', '') }
  finally { $h.Dispose() }
}
# The newest snapshot in the vault, and whether it is worth offering: it must
# be newer than the settings this copy of the app last had saved, and different.
function Get-RestoreCandidate { param($Config)
  $snaps = @(Get-ConfigSnapshots | Sort-Object { $_.saved_utc } -Descending)
  if (-not $snaps.Count) { return $null }
  $best = $snaps[0]
  $mine = ''
  try { $mine = [string]$Config.settings_saved_utc } catch { }
  if ($mine -and $mine -ge $best.saved_utc) { return $null }
  if ((Get-ConfigFingerprint $Config) -eq (Get-ConfigFingerprint $best.config)) { return $null }
  return $best
}
# First start on a vault that has no settings in it yet: this app copy's
# settings become the vault's. Called once the auth block is defined.
function Initialize-VaultSettings {
  if (-not $VaultConfigDir) { return }
  try {
    if (@(Get-ConfigSnapshots).Count) { return }
    Save-ConfigSnapshot -ConfigObj (Get-Config) -By ''
    Write-Log 'Settings of this app copy saved into the vault (first time for this vault).'
  } catch { Write-Log ('Initial settings snapshot failed: ' + $_.Exception.Message) 'WARN' }
}

function Get-VaultDataStatus {
  # NB: not $stores - PowerShell variables are case-insensitive and scoped
  # dynamically, so a local $stores would hide the script's $Stores table from
  # Get-MergedStore, which this function calls.
  $rowCounts = [ordered]@{}
  foreach ($s in @('lb_projects', 'lb_gates', 'lb_deliverables', 'lb_approvals', 'lb_issues', 'lb_audit')) {
    # .list.Count, not @(...list).Count: in Windows PowerShell 5.1 @() around a
    # generic List throws "Argument types do not match".
    try { $rowCounts[$s] = [int](Get-MergedStore $s).list.Count } catch { $rowCounts[$s] = -1; Write-Log ('Row count of ' + $s + ' failed: ' + $_.Exception.Message) 'WARN' }
  }
  $writers = New-Object System.Collections.Generic.List[object]
  if ($VaultDataDir -and (Test-Path -LiteralPath $JournalRoot)) {
    foreach ($d in [System.IO.Directory]::GetDirectories($JournalRoot)) {
      $files = @([System.IO.Directory]::GetFiles($d, '*.csv') | ForEach-Object { New-Object System.IO.FileInfo($_) })
      if (-not $files.Count) { continue }
      $last = ($files | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1).LastWriteTimeUtc
      $writers.Add(@{ writer = [System.IO.Path]::GetFileName($d); files = $files.Count; bytes = [long](($files | Measure-Object Length -Sum).Sum); last_write_utc = $last.ToString('o'); mine = ([System.IO.Path]::GetFileName($d) -eq $WriterId) })
    }
  }
  $legacy = 0
  if (Test-Path -LiteralPath $LegacyJournalRoot) { $legacy = @(Get-ChildItem -LiteralPath $LegacyJournalRoot -Recurse -Filter '*.csv' -ErrorAction SilentlyContinue).Count }
  $cfg = Get-Config
  $cand = $null
  try { $cand = Get-RestoreCandidate $cfg } catch { Write-Log ('Restore check failed: ' + $_.Exception.Message) 'WARN' }
  return @{
    enabled = [bool]$VaultDataDir; vault = $EvidenceDir; data_dir = $VaultDataDir
    stores = $rowCounts; writers = $writers.ToArray()
    old_location_files = $legacy; old_location_in_vault = $script:LegacyCovered.Count
    snapshots = @(Get-ConfigSnapshots | Sort-Object { $_.saved_utc } -Descending | ForEach-Object { @{ writer = $_.writer; by = $_.by; saved_utc = $_.saved_utc; app_version = $_.app_version } })
    settings_saved_utc = [string]$cfg.settings_saved_utc; settings_saved_by = [string]$cfg.settings_saved_by
    app_version = [string]$cfg.system_info.version
    info_workbook = $(
      $iw = Join-Path $EvidenceDir $InfoWorkbookName
      if (Test-Path -LiteralPath $iw -PathType Leaf) { $fi = Get-Item -LiteralPath $iw; @{ path = $iw; exists = $true; bytes = $fi.Length; last_write_utc = $fi.LastWriteTimeUtc.ToString('o') } }
      else { @{ path = $iw; exists = $false; bytes = 0; last_write_utc = '' } }
    )
    restore_available = [bool]$cand
    restore_from = $(if ($cand) { @{ writer = $cand.writer; by = $cand.by; saved_utc = $cand.saved_utc; app_version = $cand.app_version } } else { $null })
  }
}

# ---- the same data as an Excel file anyone can open ----
# The journals above are for the app; people open this. One workbook in the
# vault root, rewritten (never edited by hand - changes made in it are not read
# back) a few seconds after the data changes. It is a pure function of the
# merged data, so whichever PC writes it writes the same thing; a sidecar
# fingerprint stops PCs from rewriting an unchanged file over and over.
$InfoWorkbookName = 'Project_Information.xlsx'
$script:InfoDirty = $true
$script:InfoLast  = [DateTime]::MinValue

function ConvertTo-InfoTitle { param([string]$Col)
  $w = $Col -split '_' | Where-Object { $_ } | ForEach-Object {
    switch ($_.ToLowerInvariant()) { 'id' { 'ID' } 'utc' { '(UTC)' } 'pic' { 'PIC' } 'sha256' { 'SHA-256' } 'prf' { 'PRF' } 'wvn' { 'WVN' } 'wnb' { 'WNB' } 'url' { 'URL' } 'abcde' { 'ABCDE' } default { $_.Substring(0, 1).ToUpperInvariant() + $_.Substring(1) } }
  }
  return ($w -join ' ')
}
function New-InfoSheet { param([string]$Name, [string[]]$Cols, $Rows)
  $pathCols = @('file_path', 'evidence_path', 'attachment_path')
  $data = New-Object System.Collections.Generic.List[object]
  foreach ($r in $Rows) {
    $cells = New-Object 'string[]' $Cols.Count
    for ($i = 0; $i -lt $Cols.Count; $i++) {
      $v = [string]$r.($Cols[$i])
      if ($pathCols -contains $Cols[$i]) { $v = ConvertTo-StoredPath $v }
      $cells[$i] = $v
    }
    $data.Add($cells)
  }
  return @{ name = $Name; headers = @($Cols | ForEach-Object { ConvertTo-InfoTitle $_ }); rows = $data }
}
function Get-InfoSheets {
  $projects = @(Read-Store 'lb_projects')
  $audit = @(Read-Store 'lb_audit' | Sort-Object timestamp_utc -Descending | Select-Object -First 5000)
  $sheets = New-Object System.Collections.Generic.List[object]
  $sheets.Add((New-InfoSheet 'Projects' @('project_id', 'process', 'prod_family', 'family', 'class_abcde', 'status', 'prf_date', 'target_date', 'market_manager', 'country', 'customer_number', 'certifications', 'notes', 'created_by', 'created_utc', 'updated_utc') $projects))
  $sheets.Add((New-InfoSheet 'Progress by step' @('project_id', 'process', 'step_key', 'step_num', 'step_name', 'status', 'target_week', 'complexity', 'owner_pic', 'claimed_by', 'approved_by', 'approved_utc', 'evidence_cited', 'notes', 'updated_utc') @(Read-Store 'lb_gates')))
  $sheets.Add((New-InfoSheet 'Documents' @('project_id', 'step_key', 'doc_code', 'part_id', 'file_name', 'file_path', 'revision_no', 'is_active', 'status', 'approved', 'uploaded_by', 'uploaded_utc', 'kind', 'link_url', 'original_name', 'description', 'change_reason', 'sha256', 'notes') @(Read-Store 'lb_deliverables')))
  $sheets.Add((New-InfoSheet 'Approvals' @('project_id', 'step_key', 'approval_type', 'approved_by', 'approved_utc', 'evidence_count', 'comments') @(Read-Store 'lb_approvals')))
  $sheets.Add((New-InfoSheet 'Issues' @('project_id', 'step_key', 'issue_id', 'category', 'severity', 'description', 'owner', 'due_date', 'status', 'resolution', 'raised_by', 'raised_utc', 'closed_utc', 'evidence_path') @(Read-Store 'lb_issues')))
  $sheets.Add((New-InfoSheet 'Bypasses' @('project_id', 'step_key', 'authorised_by', 'authorised_utc', 'reason', 'mitigation', 'closed_utc', 'closed_note') @(Read-Store 'lb_bypasses')))
  $sheets.Add((New-InfoSheet 'Comments' @('project_id', 'doc_code', 'step_key', 'author', 'comment', 'created_utc') @(Read-Store 'lb_doc_comments')))
  $sheets.Add((New-InfoSheet 'Activity log' @('timestamp_utc', 'user', 'action', 'project_id', 'object_type', 'object_id', 'change_from', 'change_to', 'detail') $audit))
  return $sheets.ToArray()
}
function Get-InfoFingerprint { param($Sheets)
  $sb = New-Object System.Text.StringBuilder
  foreach ($s in $Sheets) {
    [void]$sb.Append([string]$s.name).Append([char]1)
    foreach ($row in $s.rows) { [void]$sb.Append(($row -join "`t")).Append("`n") }
  }
  $h = [System.Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($h.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($sb.ToString())))).Replace('-', '') }
  finally { $h.Dispose() }
}
function Get-InfoSheetXml { param($Headers, $Rows, [int]$Style = 0)
  $n = $Headers.Count
  $letters = @(0..($n - 1) | ForEach-Object { ConvertTo-ExcelCol $_ })
  $clean = { param($t) $x = [string]$t; if ($x.Length -gt 32000) { $x = $x.Substring(0, 32000) }; ConvertTo-XmlSafe ($x -replace '[\x00-\x08\x0B\x0C\x0E-\x1F]', '') }
  $sb = New-Object System.Text.StringBuilder
  [void]$sb.Append('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">')
  [void]$sb.Append('<dimension ref="A1:' + $letters[$n - 1] + ($Rows.Count + 1) + '"/>')
  [void]$sb.Append('<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft"/></sheetView></sheetViews>')
  [void]$sb.Append('<cols>')
  for ($c = 0; $c -lt $n; $c++) {
    $w = ([string]$Headers[$c]).Length
    $lim = [Math]::Min($Rows.Count, 200)
    for ($r = 0; $r -lt $lim; $r++) { $l = ([string]$Rows[$r][$c]).Length; if ($l -gt $w) { $w = $l } }
    $w = [Math]::Max(8, [Math]::Min(60, $w + 2))
    [void]$sb.Append('<col min="' + ($c + 1) + '" max="' + ($c + 1) + '" width="' + $w + '" customWidth="1"/>')
  }
  [void]$sb.Append('</cols><sheetData><row r="1">')
  for ($c = 0; $c -lt $n; $c++) { [void]$sb.Append('<c r="' + $letters[$c] + '1" s="1" t="inlineStr"><is><t xml:space="preserve">' + (& $clean $Headers[$c]) + '</t></is></c>') }
  [void]$sb.Append('</row>')
  for ($r = 0; $r -lt $Rows.Count; $r++) {
    $rn = $r + 2
    [void]$sb.Append('<row r="' + $rn + '">')
    for ($c = 0; $c -lt $n; $c++) {
      $v = [string]$Rows[$r][$c]
      if ($v -eq '') { continue }
      [void]$sb.Append('<c r="' + $letters[$c] + $rn + '"' + $(if ($Style) { ' s="' + $Style + '"' } else { '' }) + ' t="inlineStr"><is><t xml:space="preserve">' + (& $clean $v) + '</t></is></c>')
    }
    [void]$sb.Append('</row>')
  }
  [void]$sb.Append('</sheetData><autoFilter ref="A1:' + $letters[$n - 1] + ($Rows.Count + 1) + '"/></worksheet>')
  return $sb.ToString()
}
function Add-ZipText { param($Zip, [string]$Name, [string]$Text)
  $e = $Zip.CreateEntry($Name, [System.IO.Compression.CompressionLevel]::Optimal)
  $w = New-Object System.IO.StreamWriter($e.Open(), (New-Object System.Text.UTF8Encoding($false)))
  try { $w.Write($Text) } finally { $w.Dispose() }
}
function Write-InfoWorkbook { param([string]$Path, $Sheets)
  Add-Type -AssemblyName System.IO.Compression
  $main = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
  $rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
  $tmp = $Path + '.tmp_' + $WriterId
  if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Force }
  $fs = [System.IO.File]::Open($tmp, [System.IO.FileMode]::Create)
  try {
    $zip = New-Object System.IO.Compression.ZipArchive($fs, [System.IO.Compression.ZipArchiveMode]::Create)
    try {
      $ct = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
      $wb = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="' + $main + '" xmlns:r="' + $rel + '"><sheets>'
      $wr = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      for ($i = 0; $i -lt $Sheets.Count; $i++) {
        $k = $i + 1
        $nm = (([string]$Sheets[$i].name) -replace '[\[\]:\*\?/\\]', ' ')
        if ($nm.Length -gt 31) { $nm = $nm.Substring(0, 31) }
        $ct += '<Override PartName="/xl/worksheets/sheet' + $k + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        $wb += '<sheet name="' + (ConvertTo-XmlSafe $nm) + '" sheetId="' + $k + '" r:id="rId' + $k + '"/>'
        $wr += '<Relationship Id="rId' + $k + '" Type="' + $rel + '/worksheet" Target="worksheets/sheet' + $k + '.xml"/>'
        # the first sheet ("Read me") is prose: wrapped cells
        $st = if ($i -eq 0) { 2 } else { 0 }
        Add-ZipText $zip ('xl/worksheets/sheet' + $k + '.xml') (Get-InfoSheetXml -Headers $Sheets[$i].headers -Rows $Sheets[$i].rows -Style $st)
      }
      $ct += '</Types>'
      $wb += '</sheets></workbook>'
      $wr += '<Relationship Id="rId' + ($Sheets.Count + 1) + '" Type="' + $rel + '/styles" Target="styles.xml"/></Relationships>'
      Add-ZipText $zip '[Content_Types].xml' $ct
      Add-ZipText $zip '_rels/.rels' ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="' + $rel + '/officeDocument" Target="xl/workbook.xml"/></Relationships>')
      Add-ZipText $zip 'xl/workbook.xml' $wb
      Add-ZipText $zip 'xl/_rels/workbook.xml.rels' $wr
      Add-ZipText $zip 'xl/styles.xml' ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="' + $main + '"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1F3A5F"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>')
    } finally { $zip.Dispose() }
  } finally { $fs.Dispose() }
  try { Move-Item -LiteralPath $tmp -Destination $Path -Force -ErrorAction Stop }
  catch { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue; throw }
}
# Rewrites the workbook when the data changed. Cheap to call: without -Force it
# returns at once unless something was written since the last export and at
# least 15 s have passed. Never throws - the workbook is a convenience.
function Update-InfoWorkbook { param([switch]$Force)
  if (-not $Force) {
    if (-not $script:InfoDirty) { return }
    if (([DateTime]::UtcNow - $script:InfoLast).TotalSeconds -lt 15) { return }
  }
  $script:InfoLast = [DateTime]::UtcNow
  try {
    $path = Join-Path $EvidenceDir $InfoWorkbookName
    $sheets = @(Get-InfoSheets)
    $fp = Get-InfoFingerprint $sheets
    $side = ''
    if ($VaultDataDir) { $side = Join-Path $VaultDataDir 'info_workbook.sha256' }
    if (-not $Force -and $side -and (Test-Path -LiteralPath $path) -and (Test-Path -LiteralPath $side)) {
      if (([System.IO.File]::ReadAllText($side)).Trim() -eq $fp) { $script:InfoDirty = $false; return $path }
    }
    $counts = ($sheets | ForEach-Object { $_.name + ': ' + $_.rows.Count }) -join '   '
    $readme = New-Object System.Collections.Generic.List[object]
    foreach ($pair in @(
      @('What this is', 'The project register, progress by step, documents, approvals and issues of this vault, as of the time below. The app keeps this file up to date by itself a few seconds after anything changes.'),
      @('Do not edit', 'This is a read-only copy for reading, filtering and printing. Changes made here are NOT read back and are overwritten at the next update. To change data, use the Stage Gate Command Center.'),
      @('Vault', ([System.IO.Path]::GetFileName($EvidenceDir.TrimEnd('\')) + ' (this folder)')),
      @('Updated', ([DateTime]::Now.ToString('yyyy-MM-dd HH:mm:ss') + ' (local)  /  ' + [DateTime]::UtcNow.ToString('yyyy-MM-dd HH:mm:ss') + ' UTC')),
      @('Rows per sheet', $counts),
      @('File paths', 'Document paths are relative to the vault folder.'),
      @('Activity log', 'Newest 5000 entries.'))) { $readme.Add([string[]]$pair) }
    $all = @(@{ name = 'Read me'; headers = @('Topic', 'Details'); rows = $readme }) + $sheets
    Write-InfoWorkbook -Path $path -Sheets $all
    if ($side) { Set-Content -LiteralPath $side -Value $fp -Encoding ASCII }
    $script:InfoDirty = $false
    Write-Log ('Project information workbook written: ' + $path)
    return $path
  } catch {
    # most often: someone has it open in Excel. Try again in about a minute.
    $script:InfoLast = [DateTime]::UtcNow.AddSeconds(45)
    Write-Log ('Project information workbook not written: ' + $_.Exception.Message) 'WARN'
    return $null
  }
}

function Add-Audit { param([string]$User, [string]$Action, [string]$ProjectId, [string]$ObjType, [string]$ObjId, [string]$From, [string]$To, [string]$Detail)
  Add-JournalVersions -Store 'lb_audit' -Versions @(New-AuditVersion -User $User -Action $Action -ProjectId $ProjectId -ObjType $ObjType -ObjId $ObjId -From $From -To $To -Detail $Detail)
}
# v11: audit rows are append-only and nothing looks them up by number, so they
# skip the sequential minting (which would re-merge the whole, largest store on
# every action) and take a time + writer ID instead. Returned as a journal
# version so a batch can append many in one write.
function New-AuditVersion { param([string]$User, [string]$Action, [string]$ProjectId, [string]$ObjType, [string]$ObjId, [string]$From, [string]$To, [string]$Detail)
  $script:VSeq++
  $now = [DateTime]::UtcNow
  $row = @{
    log_id = ('LOG-' + $now.ToString('yyMMddHHmmssfff') + '-' + $WriterTag + ([string]($script:VSeq % 1000)).PadLeft(3, '0'))
    timestamp_utc = $now.ToString('o'); user = $User; action = $Action
    project_id = $ProjectId; object_type = $ObjType; object_id = $ObjId
    change_from = $From; change_to = $To; detail = $Detail; result = 'Success'
  }
  $full = @{}
  foreach ($c in $Stores['lb_audit']) { $full[$c] = if ($row.ContainsKey($c) -and $null -ne $row[$c]) { [string]$row[$c] } else { '' } }
  return (New-VersionRow -Values $full -Set (Get-InsertSet $full 'log_id'))
}

# ============================================================== evidence ==
function Get-SafeName { param([string]$Name)
  $clean = $Name
  foreach ($c in [System.IO.Path]::GetInvalidFileNameChars()) { $clean = $clean.Replace($c, '_') }
  return ($clean -replace '\s+', ' ').Trim()
}

# ------------------------------------------------- standardised file names --
# Two shapes, both taken from real WVN filing practice:
#   DWG   PD[WVN]_01 [Description]_[WNB].[ext]
#         e.g. PD1010523_01 Motor with PCBA_3025015.pdf
#   other [DocType]_[Model]_[WVN]_[WNB]_[Description].[ext]
#         e.g. PFMEA_CL-CORDLESS_1010523_3025015_Process_FMEA_Report.xlsx
# The drawing form keeps its spaces because that is how Design actually files
# them; everything else uses underscores. Empty parts collapse rather than
# leaving a run of separators behind.
function ConvertTo-NamePart {
  param([string]$Value, [switch]$KeepSpaces)
  $v = if ($null -eq $Value) { '' } else { [string]$Value }
  foreach ($c in [System.IO.Path]::GetInvalidFileNameChars()) { $v = $v.Replace($c, '_') }
  $v = $v -replace '[\\/:\*\?"<>\|]', '_'
  if ($KeepSpaces) { $v = ($v -replace '\s+', ' ').Trim() }
  else { $v = ($v -replace '\s+', '_') }
  $v = $v -replace '_{2,}', '_'
  return $v.Trim('_', ' ', '.')
}

function Get-LegacyStandardFileName {
  # The two shapes that shipped hard-coded from v2.1 through v11.0 (see
  # config.json deployment_defaults.filename_conventions for the human
  # description). Kept as the built-in fallback for an install whose
  # config.json has no naming.rules yet, and as what a "Reset to default"
  # button in Settings restores.
  param([string]$DocType, [string]$Model, [string]$WvnId, [string]$WnbId, [string]$Description, [string]$OriginalName)
  $ext = ([System.IO.Path]::GetExtension($OriginalName)).ToLowerInvariant()
  if (-not $Description) { $Description = [System.IO.Path]::GetFileNameWithoutExtension($OriginalName) }
  if ($DocType -eq 'DWG' -and (ConvertTo-NamePart $WvnId)) {
    $wvn  = ConvertTo-NamePart $WvnId
    $wnb  = ConvertTo-NamePart $WnbId
    $desc = ConvertTo-NamePart $Description -KeepSpaces
    $name = 'PD' + $wvn + '_01'
    $suffix = @()
    if ($desc) { $suffix += [pscustomobject]@{ text = $desc; sep = ' ' } }
    if ($wnb)  { $suffix += [pscustomobject]@{ text = $wnb;  sep = '_' } }
    foreach ($part in $suffix) { $name += $part.sep + $part.text }
    return $name + $ext
  }
  $parts = @($DocType, $Model, $WvnId, $WnbId, $Description) |
           ForEach-Object { ConvertTo-NamePart $_ } |
           Where-Object { $_ }
  if (-not $parts.Count) { return (ConvertTo-NamePart $OriginalName) + $ext }
  return (($parts -join '_').Trim('_', ' ', '.')) + $ext
}

# ------------------------------------------- v11.1 configurable naming -----
# Non-technical admins edit this from Settings -> File naming standard: an
# ordered list of rules, each an ordered list of "segments" (a fixed field
# like doc_code/description, or literal text), rather than a format string —
# the whole point is that nobody has to type punctuation-sensitive syntax.
# The first rule whose doc_codes list contains the document wins; a rule with
# an empty doc_codes list is the default and only one of those should exist
# (Test-NamingRules warns, doesn't enforce, since "last one wins" is still a
# well-defined and recoverable outcome).
function ConvertTo-NamingLiteral {
  # A literal segment is admin-typed, on purpose (a separator, a prefix like
  # "PD") - unlike ConvertTo-NamePart/Get-SafeName, it must come back
  # UNCHANGED except for characters Windows genuinely cannot put in a file
  # name at all, or a whitespace-only or underscore-only literal (a perfectly
  # normal separator) would be trimmed away to nothing.
  param([string]$Value)
  $v = if ($null -eq $Value) { '' } else { [string]$Value }
  foreach ($c in [System.IO.Path]::GetInvalidFileNameChars()) { $v = $v.Replace($c, '_') }
  return $v
}
function Get-NamingFieldValue {
  param([string]$Key, [hashtable]$Values, [string]$OriginalName)
  if ($Values.ContainsKey($Key)) { return [string]$Values[$Key] }
  if ($Key -eq 'description') { return [System.IO.Path]::GetFileNameWithoutExtension($OriginalName) }
  return ''
}
function Format-NamingTemplate {
  param($Rule, [hashtable]$Values, [string]$OriginalName)
  $ext = ([System.IO.Path]::GetExtension($OriginalName)).ToLowerInvariant()
  $sb = New-Object System.Text.StringBuilder
  foreach ($seg in @($Rule.segments)) {
    if ([string]$seg.type -eq 'text') { [void]$sb.Append((ConvertTo-NamingLiteral ([string]$seg.value))); continue }
    $raw = Get-NamingFieldValue -Key ([string]$seg.key) -Values $Values -OriginalName $OriginalName
    [void]$sb.Append((ConvertTo-NamePart $raw -KeepSpaces:([bool]$seg.keep_spaces)))
  }
  # A blank field leaves its neighbouring "_" separators doubled up (e.g. no
  # WNB code between two underscore segments) - collapsed here exactly like
  # the pre-v11.1 hard-coded shapes did, so "empty segments are dropped"
  # keeps holding without every admin-authored rule having to special-case it.
  $name = ($sb.ToString() -replace '_{2,}', '_').Trim('_', ' ', '.')
  if (-not $name) { $name = ConvertTo-NamePart ([System.IO.Path]::GetFileNameWithoutExtension($OriginalName)) }
  return $name + $ext
}
function Get-NamingRule {
  param($Config, [string]$DocCode)
  $rules = @($Config.naming.rules)
  if (-not $rules -or -not $rules.Count) { return $null }
  $code = ([string]$DocCode).ToUpperInvariant()
  foreach ($r in $rules) {
    $codes = @($r.doc_codes) | ForEach-Object { ([string]$_).ToUpperInvariant() }
    if ($codes -and $codes.Count -and ($codes -contains $code)) { return $r }
  }
  foreach ($r in $rules) {
    $codes = @($r.doc_codes)
    if (-not $codes -or -not $codes.Count) { return $r }
  }
  return $null
}
# Every field a naming rule segment can reference, with a one-line label for
# the Settings UI. Kept here (not just in app.js) so the server-rendered
# preview endpoint and the validator both stay in sync with the real list.
$NamingFieldDefs = @(
  @{ key = 'doc_code';   label = 'Document code (e.g. DWG)' }
  @{ key = 'model';      label = 'Model / family (e.g. 9649LP)' }
  @{ key = 'wvn_id';     label = 'WVN code' }
  @{ key = 'wnb_id';     label = 'WNB / customer number' }
  @{ key = 'description';label = 'Description (falls back to the original file name)' }
  @{ key = 'project_id'; label = 'Project ID' }
  @{ key = 'part';       label = 'Part / category' }
  @{ key = 'date';       label = 'Today''s date (YYYYMMDD)' }
  @{ key = 'time';       label = 'Time of upload (HHMMSS)' }
)

function Get-StandardFileName {
  param([string]$DocType, [string]$Model, [string]$WvnId, [string]$WnbId, [string]$Description, [string]$OriginalName, [string]$Category, [string]$ProjectId, $Config)
  $cfg = if ($Config) { $Config } else { try { Get-Config } catch { $null } }
  $rule = Get-NamingRule -Config $cfg -DocCode $DocType
  if (-not $rule) { return Get-LegacyStandardFileName -DocType $DocType -Model $Model -WvnId $WvnId -WnbId $WnbId -Description $Description -OriginalName $OriginalName }
  $now = [DateTime]::UtcNow
  $values = @{
    doc_code = $DocType; model = $Model; wvn_id = $WvnId; wnb_id = $WnbId
    description = $Description; project_id = $ProjectId; part = $Category
    date = $now.ToString('yyyyMMdd'); time = $now.ToString('HHmmss')
  }
  return Format-NamingTemplate -Rule $rule -Values $values -OriginalName $OriginalName
}

# Validates a whole draft rule list before it is saved. Returns error strings;
# empty means the list is acceptable. Deliberately permissive about overlap
# (first match wins, so ordering resolves it) but catches the mistakes that
# would actually break filing: no segments, an unknown field key, two default
# rules (silently ambiguous - whichever the admin listed last would win and
# they would have no way to tell from the editor which one that is).
function Test-NamingRules {
  param($Rules)
  $errs = @()
  $list = @($Rules)
  if (-not $list.Count) { return @('At least one naming rule is required.') }
  $validKeys = @($script:NamingFieldDefs | ForEach-Object { $_.key })
  $seenIds = @{}
  $defaults = 0
  foreach ($r in $list) {
    $id = [string]$r.id
    if (-not $id) { $errs += 'Every naming rule needs an id.'; continue }
    if ($seenIds.ContainsKey($id)) { $errs += ("Naming rule id '" + $id + "' is used twice."); continue }
    $seenIds[$id] = $true
    if (-not ([string]$r.label).Trim()) { $errs += ("Naming rule " + $id + ": a label is required.") }
    $codes = @($r.doc_codes)
    if (-not $codes -or -not $codes.Count) { $defaults++ }
    $segs = @($r.segments)
    if (-not $segs.Count) { $errs += ("Naming rule " + $id + ": needs at least one segment (a field or literal text)."); continue }
    $hasField = $false
    foreach ($s in $segs) {
      if ([string]$s.type -eq 'text') {
        if (-not ([string]$s.value)) { $errs += ("Naming rule " + $id + ": a text segment cannot be empty - remove it or fill it in.") }
        continue
      }
      $hasField = $true
      if ($validKeys -notcontains [string]$s.key) { $errs += ("Naming rule " + $id + ": '" + [string]$s.key + "' is not a field this tool knows about.") }
    }
    if (-not $hasField) { $errs += ("Naming rule " + $id + ": needs at least one field, or every file with this rule gets the same name.") }
  }
  if ($defaults -gt 1) { $errs += ('More than one rule applies to "everything else" (an empty document-code list) - only the last one in the list would ever be used. Give every rule but one a specific document list.') }
  return $errs
}

function Save-Evidence {
  param([string]$DocType, [string]$Family, [string]$PartId, [string]$FileName, [byte[]]$Bytes,
        # v12: folder levels already resolved from the admin's folder
        # structure (Resolve-EvidenceLevels). Omitted by callers that have no
        # project context (the LFI writer), which keep the built-in shape.
        [string[]]$LevelNames = $null)
  # v3.6 hierarchy: [Family]\[DocType]\[file] — you browse to a specific
  # model (Family, e.g. 9649LP), then a kind of document, which is how people
  # actually look for one. This app never tracks individual finished-good /
  # child SKUs, so there is no level below Family for one - the old FgId
  # level here always received an empty string (nothing populated it since
  # v3.5) and has been dropped rather than kept as permanent dead weight.
  # PartId, when given, sits one level below DocType; it is absent from the
  # stated pattern because it is almost always blank.
  $levels = @($Family, $DocType, $PartId) |
            ForEach-Object { if ($null -eq $_) { '' } else { (Get-SafeName ([string]$_)) } } |
            Where-Object { $_ -ne '' }
  if ($null -ne $LevelNames) { $levels = @($LevelNames | Where-Object { $_ }) }
  $destDir = (@($EvidenceDir) + $levels) -join '\'
  if (-not (Test-Path -LiteralPath $destDir)) { New-Item -ItemType Directory -Path $destDir -Force | Out-Null }

  $safeFile = Get-SafeName $FileName
  $ext = [System.IO.Path]::GetExtension($safeFile)
  $base = [System.IO.Path]::GetFileNameWithoutExtension($safeFile)
  $destPath = Join-Path $destDir $safeFile

  $sha = [System.Security.Cryptography.SHA256]::Create()
  $newHash = ([BitConverter]::ToString($sha.ComputeHash($Bytes))).Replace('-', '').ToLowerInvariant()
  $sha.Dispose()

  # v11: the stored name ends in the first 8 hex of the file's SHA-256. On a
  # OneDrive-synced vault two PCs can file the same document (same standard
  # name) inside one sync window without seeing each other's file; without
  # the suffix OneDrive renames one of them and that PC's row points at the
  # other PC's bytes. Content-addressed names cannot collide, and identical
  # bytes still land on the identical name (a duplicate, not a new file).
  $safeFile = $base + '_' + $newHash.Substring(0, 8) + $ext
  $base = [System.IO.Path]::GetFileNameWithoutExtension($safeFile)
  $destPath = Join-Path $destDir $safeFile

  $duplicate = $false
  if (Test-Path -LiteralPath $destPath) {
    $existingBytes = [System.IO.File]::ReadAllBytes($destPath)
    $sha2 = [System.Security.Cryptography.SHA256]::Create()
    $existingHash = ([BitConverter]::ToString($sha2.ComputeHash($existingBytes))).Replace('-', '').ToLowerInvariant()
    $sha2.Dispose()
    if ($existingHash -eq $newHash) { $duplicate = $true }
    else {
      $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
      $safeFile = $base + '_' + $stamp + $ext
      $destPath = Join-Path $destDir $safeFile
    }
  }
  if (-not $duplicate) { [System.IO.File]::WriteAllBytes($destPath, $Bytes) }

  # v2.1: the absolute path is what a user pastes into Explorer, so that is what
  # gets stored; the vault-relative one is only for display.
  $relPath = $destPath.Substring($EvidenceDir.Length).TrimStart('\')
  return [pscustomobject]@{ fileName = $safeFile; path = $destPath; relPath = $relPath; sha256 = $newHash; duplicate = $duplicate; bytes = $Bytes.Length }
}

# ------------------------------------------------------ target date fallback --
# When the browser sends no manual override, the server computes one from the
# configured cycle-time baselines. Precedence order:
#   1. change_types[].cycle_time_days   (matched on class_abcde / type_id)
#   2. prod_families[].typical_lead_time_days  (matched case-insensitively
#      on prod_family_id, then on sample_fg_ids)
#   3. empty string  (legitimate — Type A has no baselined cycle time yet)
# PRF date is parsed defensively; a malformed or missing input yields an empty
# target, never a crash or a 1-Jan-0001.
#
# -Identifier takes the candidates in preference order, because two different
# fields can name the product family category: the "Product family" picker
# holds a real prod_family_id, while the resolved Family (the specific model
# code) is checked as a fallback in case it happens to collide with a
# category id or one of its configured sample codes. The explicit picker is
# checked first; the model code is the fallback. Blank candidates are skipped
# rather than matched, or a project with no category would match a category
# whose id happened to be empty.
# ISO-8601 week helpers, mirroring isoWeek()/weekToDate() in app.js so the
# server and the browser always agree on what week a date falls in.
# [System.Globalization.ISOWeek] is .NET Core only - PS 5.1 runs on .NET
# Framework 4.x - so the arithmetic is done by hand.
function ConvertTo-IsoWeek {
  param([datetime]$Date)
  $d = $Date.Date
  # The Thursday of a week decides which year the week belongs to, which is
  # what makes 31 Dec correctly land in week 1 of the following year.
  $dow = [int]$d.DayOfWeek; if ($dow -eq 0) { $dow = 7 }
  $thursday = $d.AddDays(4 - $dow)
  $week = [math]::Floor(($thursday.DayOfYear - 1) / 7) + 1
  return ('{0:0000}-W{1:00}' -f $thursday.Year, $week)
}
function ConvertFrom-IsoWeek {
  param([string]$Week)     # 'YYYY-Www' -> the Monday of that week
  if ($Week -notmatch '^(\d{4})-W(\d{2})$') { return $null }
  $y = [int]$Matches[1]; $w = [int]$Matches[2]
  # ISO week 1 is the week containing 4 January, by definition.
  $jan4 = New-Object datetime($y, 1, 4)
  $dow = [int]$jan4.DayOfWeek; if ($dow -eq 0) { $dow = 7 }
  return $jan4.AddDays(1 - $dow).AddDays(($w - 1) * 7)
}

function Get-TargetDate {
  param([string]$ClassAbcde, [string[]]$Identifier, [string]$PrfDate, $Config)
  if (-not $PrfDate) { return '' }
  $PrfDate = $PrfDate.Trim()

  # v3.0 moved every planning field to ISO weeks (type="week"), so this now
  # receives '2026-W33', not '2026-08-06'. Parsing only yyyy-MM-dd meant every
  # call returned '' - the server-side target-date fallback had been silently
  # dead since v3.0, which mattered most for CSV rows that leave target_date
  # blank and expect the cycle time to fill it in.
  # Whichever format comes in, the same format goes out.
  $asWeek = $PrfDate -match '^\d{4}-W\d{2}$'
  $prf = $null
  if ($asWeek) {
    $prf = ConvertFrom-IsoWeek $PrfDate
  } else {
    try { $prf = [datetime]::ParseExact($PrfDate, 'yyyy-MM-dd', [System.Globalization.CultureInfo]::InvariantCulture) } catch { return '' }
  }
  if (-not $prf) { return '' }

  # Whole weeks, rounded up - the same [math]::Ceiling(days / 7) the browser's
  # targetDateFor() applies, so a project registered through the UI and one
  # imported from CSV land on the same target week.
  $emit = {
    param([int]$days)
    if ($asWeek) { return ConvertTo-IsoWeek $prf.AddDays(7 * [math]::Ceiling($days / 7.0)) }
    return $prf.AddDays($days).ToString('yyyy-MM-dd', [System.Globalization.CultureInfo]::InvariantCulture)
  }.GetNewClosure()

  # 1. Change type cycle time
  $ct = @($Config.change_types | Where-Object { $_.type_id -eq $ClassAbcde })
  if ($ct.Count -gt 0 -and $null -ne $ct[0].cycle_time_days) {
    return (& $emit ([int]$ct[0].cycle_time_days))
  }

  # 2. Product family lead time — match prod_family_id then sample_fg_ids
  $families = @($Config.prod_families)
  $fam = $null
  :idloop foreach ($cand in @($Identifier)) {
    $c = ([string]$cand).Trim()
    if (-not $c) { continue }
    foreach ($pf in $families) {
      if (([string]$pf.prod_family_id).Equals($c, [System.StringComparison]::OrdinalIgnoreCase)) {
        $fam = $pf; break idloop
      }
    }
    foreach ($pf in $families) {
      foreach ($id in @($pf.sample_fg_ids)) {
        if (([string]$id).Equals($c, [System.StringComparison]::OrdinalIgnoreCase)) {
          $fam = $pf; break idloop
        }
      }
    }
  }
  if ($fam -and $null -ne $fam.typical_lead_time_days) {
    return (& $emit ([int]$fam.typical_lead_time_days))
  }

  # 3. No baseline configured — empty is the honest answer
  return ''
}

# ================================================================== HTTP ==
function New-JsonResponse {
  param([System.Net.HttpListenerResponse]$Response, [int]$StatusCode, $Body)
  $json = $Body | ConvertTo-Json -Depth 12 -Compress
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
  $Response.StatusCode = $StatusCode
  $Response.ContentType = 'application/json; charset=utf-8'
  $Response.ContentLength64 = $bytes.Length
  $Response.OutputStream.Write($bytes, 0, $bytes.Length)
  # Flush before Close so the bytes are handed to http.sys while this thread is
  # still alive. Close() alone is enough for a server that keeps running, but
  # /api/shutdown terminates the process immediately afterwards - without the
  # explicit flush the client can see a dropped socket instead of the 200.
  $Response.OutputStream.Flush()
  $Response.OutputStream.Close()
}
function New-FileResponse {
  param([System.Net.HttpListenerResponse]$Response, [string]$Path, [string]$ContentType)
  $bytes = [System.IO.File]::ReadAllBytes($Path)
  $Response.StatusCode = 200
  # app.js / styles.css / index.html are served from disk and change on every
  # release. Without these the browser keeps its copy indefinitely - the tool
  # is versionless from the cache's point of view (no ETag, no query hash), so
  # an upgraded install keeps running the old frontend against the new API and
  # every symptom points at the wrong file.
  $Response.Headers.Add('Cache-Control', 'no-store, no-cache, must-revalidate')
  $Response.Headers.Add('Pragma', 'no-cache')
  $Response.ContentType = $ContentType
  $Response.ContentLength64 = $bytes.Length
  $Response.OutputStream.Write($bytes, 0, $bytes.Length)
  $Response.OutputStream.Flush()
  $Response.OutputStream.Close()
}

# Shutdown kills the process, so it must never be reachable from another
# machine. The listener only binds loopback prefixes (localhost, 127.0.0.1,
# ::1) so remote clients cannot arrive here in the first place, but the check
# is asserted explicitly rather than inferred from the prefix - a future
# prefix change must not silently turn this into a remote kill switch.
#
# This replaces the v2.4 Origin-authority comparison, which returned 403 for
# perfectly legitimate local requests whenever the browser's Origin authority
# and $req.Url.Authority disagreed - which is exactly what happens when the
# launcher falls back to port 8081/8082, or when a client sends no Origin.
function Test-LoopbackRequest {
  param([System.Net.HttpListenerRequest]$Request)
  try {
    $ep = $Request.RemoteEndPoint
    if ($null -eq $ep -or $null -eq $ep.Address) { return $false }
    $addr = $ep.Address
    # Covers 127.0.0.0/8 and ::1. An IPv4-mapped IPv6 loopback (::ffff:127.0.0.1)
    # is not recognised by IsLoopback, so it is unmapped first.
    if ($addr.IsIPv4MappedToIPv6) { $addr = $addr.MapToIPv4() }
    return [System.Net.IPAddress]::IsLoopback($addr)
  } catch { return $false }
}
function Read-JsonBody {
  param([System.Net.HttpListenerRequest]$Request)
  # v11: JSON is UTF-8 (RFC 8259). HttpListener's ContentEncoding falls back
  # to the ANSI code page (cp1252) when the request names no charset - which
  # app.js never did - so every POST carrying non-ASCII text (Vietnamese
  # names, comments, issue text, Settings edits) was stored as mojibake, and
  # each Settings save re-mangled what it echoed back (config.json had em
  # dashes encoded 3 and 5 levels deep). Only an explicit charset overrides.
  $enc = [System.Text.Encoding]::UTF8
  if (([string]$Request.ContentType) -match 'charset\s*=\s*"?([A-Za-z0-9_\-]+)') {
    try { $enc = [System.Text.Encoding]::GetEncoding($Matches[1]) } catch { $enc = [System.Text.Encoding]::UTF8 }
  }
  $reader = New-Object System.IO.StreamReader($Request.InputStream, $enc)
  $text = $reader.ReadToEnd(); $reader.Close()
  $obj = if ($text) { $text | ConvertFrom-Json } else { $null }
  # v12: the acting user is whoever is signed in, never whoever the request
  # body says it is. Every endpoint below reads $body.user (and /api/action
  # reads $body.audit.user) exactly as before; the value is simply replaced
  # here, in the one place every body passes through, so no endpoint can
  # forget to do it.
  if ($script:ReqUser) {
    if ($null -eq $obj) { $obj = [pscustomobject]@{} }
    if ($obj -is [System.Management.Automation.PSCustomObject]) {
      $obj | Add-Member -NotePropertyName user -NotePropertyValue $script:ReqUser -Force
      if ($obj.audit -is [System.Management.Automation.PSCustomObject]) {
        $obj.audit | Add-Member -NotePropertyName user -NotePropertyValue $script:ReqUser -Force
      }
    }
    return $obj
  }
  if ($null -eq $obj) { return @{} }
  return $obj
}
function ConvertTo-Hashtable {
  param($Obj)
  $h = @{}
  if ($null -eq $Obj) { return $h }
  foreach ($p in $Obj.PSObject.Properties) { $h[$p.Name] = $p.Value }
  return $h
}

$MimeTypes = @{ '.html'='text/html; charset=utf-8'; '.css'='text/css; charset=utf-8'; '.js'='application/javascript; charset=utf-8'; '.json'='application/json; charset=utf-8' }

function Get-AllTracking {
  $out = @{}
  foreach ($store in $Stores.Keys) { $out[$store] = @(Read-Store $store) }
  return $out
}

# ============================================================ report engine ==

function ConvertTo-ExcelCol { param([int]$Idx)
  $result = ''
  $n = $Idx
  while ($n -ge 0) {
    $result = [char]([int][char]'A' + [int]($n % 26)) + $result
    $n = [int][Math]::Floor($n / 26) - 1
  }
  return $result
}

function ConvertTo-XmlSafe { param($Value)
  if ($null -eq $Value) { return '' }
  return ([string]$Value).Replace('&','&amp;').Replace('<','&lt;').Replace('>','&gt;').Replace('"','&quot;').Replace("'",'&apos;')
}

# Whole-number percent (e.g. 75) -> the decimal fraction string Excel expects
# under a "0%" number format (e.g. "0.75"). Always invariant-culture: the host
# OS locale may use a comma decimal separator, which would corrupt the numeric
# regex check in New-ReportCellXml below.
function ConvertTo-PctFraction { param([double]$Pct)
  return ($Pct / 100.0).ToString('0.####', [System.Globalization.CultureInfo]::InvariantCulture)
}

# Appends the report's own header/body/percent formats to a template's
# styles.xml and hands back the cellXfs indexes they landed at. Indexes CANNOT
# be hardcoded: each template ships a different number of fonts/fills/borders
# /cellXfs (104 vs 282 in the two shipped suites), and half of them namespace
# every element as x: while the rest use none. Both are detected here.
function Add-ReportStyles { param([string]$StylesXml)
  $p = ''
  if ($StylesXml -match '<(\w+):styleSheet') { $p = $Matches[1] + ':' }

  function Add-Before { param([string]$Xml, [string]$Tag, [string]$Fragment, [string]$Pfx)
    # Bump the container's count= and insert the new child just before its
    # closing tag. Excel treats a count that disagrees with the child total as
    # a corrupt file, so the two must move together.
    $close = '</' + $Pfx + $Tag + '>'
    $idx = $Xml.LastIndexOf($close)
    if ($idx -lt 0) { return $null }
    $countMatch = [regex]::Match($Xml, '<' + $Pfx + $Tag + '[^>]*\bcount="(\d+)"')
    if (-not $countMatch.Success) { return $null }
    $oldCount = [int]$countMatch.Groups[1].Value
    $Xml = $Xml.Substring(0, $idx) + $Fragment + $Xml.Substring($idx)
    $Xml = $Xml.Remove($countMatch.Index, $countMatch.Length).Insert($countMatch.Index,
      ('<' + $Pfx + $Tag + ' count="' + ($oldCount + 1) + '"'))
    return @{ xml = $Xml; index = $oldCount }
  }

  $fontXml   = '<' + $p + 'font><' + $p + 'b /><' + $p + 'color rgb="FFFFFFFF" /><' + $p + 'sz val="11" /><' + $p + 'name val="Calibri" /></' + $p + 'font>'
  $fillXml   = '<' + $p + 'fill><' + $p + 'patternFill patternType="solid"><' + $p + 'fgColor rgb="FF0F2438" /><' + $p + 'bgColor indexed="64" /></' + $p + 'patternFill></' + $p + 'fill>'
  $edge      = '<' + $p + 'left style="thin"><' + $p + 'color rgb="FFD7E0E9" /></' + $p + 'left><' + $p + 'right style="thin"><' + $p + 'color rgb="FFD7E0E9" /></' + $p + 'right><' + $p + 'top style="thin"><' + $p + 'color rgb="FFD7E0E9" /></' + $p + 'top><' + $p + 'bottom style="thin"><' + $p + 'color rgb="FFD7E0E9" /></' + $p + 'bottom>'
  $borderXml = '<' + $p + 'border>' + $edge + '</' + $p + 'border>'

  $r = Add-Before -Xml $StylesXml -Tag 'fonts' -Fragment $fontXml -Pfx $p
  if (-not $r) { return $null }
  $StylesXml = $r.xml; $fontId = $r.index
  $r = Add-Before -Xml $StylesXml -Tag 'fills' -Fragment $fillXml -Pfx $p
  if (-not $r) { return $null }
  $StylesXml = $r.xml; $fillId = $r.index
  $r = Add-Before -Xml $StylesXml -Tag 'borders' -Fragment $borderXml -Pfx $p
  if (-not $r) { return $null }
  $StylesXml = $r.xml; $borderId = $r.index

  # numFmtId 10 is the built-in "0.00%" — no numFmts entry needed for it.
  $headerXf  = '<' + $p + 'xf numFmtId="0" fontId="' + $fontId + '" fillId="' + $fillId + '" borderId="' + $borderId + '" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><' + $p + 'alignment horizontal="center" vertical="center" wrapText="1" /></' + $p + 'xf>'
  $bodyXf    = '<' + $p + 'xf numFmtId="0" fontId="0" fillId="0" borderId="' + $borderId + '" xfId="0" applyBorder="1" />'
  $percentXf = '<' + $p + 'xf numFmtId="10" fontId="0" fillId="0" borderId="' + $borderId + '" xfId="0" applyNumberFormat="1" applyBorder="1" />'

  $r = Add-Before -Xml $StylesXml -Tag 'cellXfs' -Fragment $headerXf -Pfx $p
  if (-not $r) { return $null }
  $StylesXml = $r.xml; $headerIdx = $r.index
  $r = Add-Before -Xml $StylesXml -Tag 'cellXfs' -Fragment $bodyXf -Pfx $p
  if (-not $r) { return $null }
  $StylesXml = $r.xml; $bodyIdx = $r.index
  $r = Add-Before -Xml $StylesXml -Tag 'cellXfs' -Fragment $percentXf -Pfx $p
  if (-not $r) { return $null }
  $StylesXml = $r.xml; $percentIdx = $r.index

  return @{ xml = $StylesXml; header = $headerIdx; body = $bodyIdx; percent = $percentIdx }
}

function New-ReportCellXml { param([string]$Col, $Value, [int]$Row, [string]$Ns, [string]$StyleIdx)
  $ref = "${Col}${Row}"
  $s = [string]$Value
  $sAttr = ''
  if ($StyleIdx -ne '') { $sAttr = ' s="' + $StyleIdx + '"' }
  # Legacy safety net: a "75%" string (old callers, or any future report type
  # that still appends the sign) fails the numeric regex below and would land
  # as inlineStr text, breaking SUM()/AVERAGE()/Pivot Charts on the Dashboard
  # sheet. Strip the sign and store the underlying fraction instead.
  if ($s -match '^-?\d+(\.\d+)?%$') {
    $frac = [double]::Parse($s.TrimEnd('%'), [System.Globalization.CultureInfo]::InvariantCulture) / 100.0
    $s = $frac.ToString('0.####', [System.Globalization.CultureInfo]::InvariantCulture)
  }
  # Numeric: a plain integer or decimal (e.g. "5", "3.14"). Reject values that
  # start with a zero followed by a digit (e.g. "01") — those are identifiers,
  # not numbers, and Excel would strip the leading zero if stored as numeric.
  if ($s -match '^-?\d+(\.\d+)?$' -and $s -notmatch '^-?0\d') {
    return "<${Ns}c r=`"${ref}`"${sAttr}><${Ns}v>$s</${Ns}v></${Ns}c>"
  }
  $safe = ConvertTo-XmlSafe $s
  return "<${Ns}c r=`"${ref}`"${sAttr} t=`"inlineStr`"><${Ns}is><${Ns}t>$safe</${Ns}t></${Ns}is></${Ns}c>"
}

function New-ReportRowXml {
  param(
    [string[]]$Values, [int]$RowNum, [string]$Ns,
    [string]$BodyStyle = '', [string]$PercentStyle = '', [string]$HeaderStyle = '',
    [switch]$IsHeader, [int[]]$PctCols = @()
  )
  $cells = for ($ci = 0; $ci -lt $Values.Count; $ci++) {
    $style = $BodyStyle
    if ($IsHeader) { $style = $HeaderStyle }
    elseif ($PercentStyle -ne '' -and $PctCols -contains $ci) { $style = $PercentStyle }
    New-ReportCellXml -Col (ConvertTo-ExcelCol $ci) -Value $Values[$ci] -Row $RowNum -Ns $Ns -StyleIdx $style
  }
  # Header rows get an explicit height so the navy band reads as a banner
  # rather than a slightly-darker data row.
  $rowAttrs = ''
  if ($IsHeader) { $rowAttrs = ' ht="28" customHeight="1"' }
  return "<${Ns}row r=`"${RowNum}`"${rowAttrs}>$($cells -join '')</${Ns}row>"
}

# Forces gridlines on and gives every generated column a workable width. The
# templates ship <cols> sized for their original column schema, which no longer
# matches what Get-ReportData emits, so the old block is replaced outright.
function Set-ReportSheetChrome { param([string]$SheetXml, [string]$Ns, [int]$ColCount)
  if ($ColCount -lt 1) { $ColCount = 1 }
  $colsXml = '<' + $Ns + 'cols><' + $Ns + 'col min="1" max="' + $ColCount + '" width="22" customWidth="1" /></' + $Ns + 'cols>'
  if ($SheetXml -match ('<' + $Ns + 'cols>.*?</' + $Ns + 'cols>')) {
    $SheetXml = [regex]::Replace($SheetXml, '<' + $Ns + 'cols>.*?</' + $Ns + 'cols>', $colsXml, [System.Text.RegularExpressions.RegexOptions]::Singleline)
  } else {
    $SheetXml = [regex]::Replace($SheetXml, '(<' + $Ns + 'sheetData)', $colsXml + '$1', [System.Text.RegularExpressions.RegexOptions]::None)
  }
  $viewsXml = '<' + $Ns + 'sheetViews><' + $Ns + 'sheetView showGridLines="1" workbookViewId="0" /></' + $Ns + 'sheetViews>'
  if ($SheetXml -match ('<' + $Ns + 'sheetViews>.*?</' + $Ns + 'sheetViews>')) {
    $SheetXml = [regex]::Replace($SheetXml, '<' + $Ns + 'sheetViews>.*?</' + $Ns + 'sheetViews>', $viewsXml, [System.Text.RegularExpressions.RegexOptions]::Singleline)
  } elseif ($SheetXml -match ('<' + $Ns + 'sheetFormatPr')) {
    $SheetXml = [regex]::Replace($SheetXml, '(<' + $Ns + 'sheetFormatPr)', $viewsXml + '$1', [System.Text.RegularExpressions.RegexOptions]::None)
  }
  return $SheetXml
}

function ConvertTo-IsoWeek { param($Value)
  $s = [string]$Value
  if (-not $s) { return '' }
  if ($s -match '^\d{4}-W\d{2}$') { return $s }
  try {
    $d = [datetime]::Parse($s)
    $d = $d.Date
    $day = $d.DayOfWeek.value__
    if ($day -eq 0) { $day = 7 }
    $d = $d.AddDays(4 - $day)
    $yearStart = Get-Date -Year $d.Year -Month 1 -Day 1
    $weekNum = [Math]::Ceiling((($d - $yearStart).TotalDays + 1) / 7)
    return "$($d.Year)-W$($weekNum.ToString('00'))"
  } catch { return '' }
}

function Get-NowWeek {
  $d = Get-Date
  $day = $d.DayOfWeek.value__
  if ($day -eq 0) { $day = 7 }
  $d = $d.AddDays(4 - $day)
  $yearStart = Get-Date -Year $d.Year -Month 1 -Day 1
  $weekNum = [Math]::Ceiling((($d - $yearStart).TotalDays + 1) / 7)
  return "$($d.Year)-W$($weekNum.ToString('00'))"
}

# "YYYY-Www" -> a linearly-comparable integer (year*53+week). Not calendar-
# exact around year boundaries (ISO years can have 52 or 53 weeks), but that's
# fine here — this only feeds an "is the target week near/behind now" check,
# not date arithmetic that needs to be exact.
function Get-WeekIndex { param([string]$IsoWeek)
  if ($IsoWeek -notmatch '^(\d{4})-W(\d{2})$') { return $null }
  return ([int]$Matches[1]) * 53 + [int]$Matches[2]
}

# Reports need a single at-a-glance status per project. Mirrors the
# COMPLETE/LATE/IN_PROGRESS states classifyProject() computes client-side in
# app.js, split into the 4 labels the XLSX report templates were built
# around (On Track / At Risk / Late / Complete). "At Risk" = due within 2
# ISO weeks and not yet complete.
function Get-TransferStatus { param([bool]$Complete, [string]$TargetWeek, [string]$NowWeek)
  if ($Complete) { return 'Complete' }
  $ti = Get-WeekIndex $TargetWeek
  $ni = Get-WeekIndex $NowWeek
  if ($null -eq $ti -or $null -eq $ni) { return 'On Track' }
  if ($ti -lt $ni) { return 'Late' }
  if ($ti - $ni -le 2) { return 'At Risk' }
  return 'On Track'
}

# "NPI-4" / "ECN-11" -> the human step_name from config, e.g. "Prototype
# Validation". Falls back to the raw step_key if the process or step_id
# can't be resolved (e.g. the step was renumbered after the issue was
# raised) so a report row never goes blank.
function Get-StepName { param([string]$StepKey, $Config)
  $step = Get-StepDef -Config $Config -StepKey $StepKey
  if ($step) { return [string]$step.step_name }
  return $StepKey
}

# Every process the config defines, each as @{ process_id; steps; gate_mode }.
# The one place the server learns which processes exist - v11 R4 adds
# config.pillars[]; without it the two legacy workflow objects are used, so
# existing data behaves exactly as before.
function Get-ProcessDefs { param($Config)
  $out = @()
  $pillars = @($Config.pillars | Where-Object { $_ -and $_.process_id })
  if ($pillars.Count) {
    foreach ($pl in $pillars) {
      $steps = @()
      if ($pl.workflow -and $Config.($pl.workflow)) { $steps = @($Config.($pl.workflow).steps) } elseif ($pl.steps) { $steps = @($pl.steps) }
      $gm = if ([string]$pl.gate_mode -eq 'flagged') { 'flagged' } else { 'all' }
      $out += ,([pscustomobject]@{ process_id = [string]$pl.process_id; steps = $steps; gate_mode = $gm; doc_types = @($pl.doc_types); name = [string]$pl.name })
    }
    return $out
  }
  if ($Config.npi_workflow) { $out += ,([pscustomobject]@{ process_id = 'NPI'; steps = @($Config.npi_workflow.steps); gate_mode = 'all'; doc_types = @(); name = 'NPI' }) }
  if ($Config.ecn_workflow) { $out += ,([pscustomobject]@{ process_id = 'ECN'; steps = @($Config.ecn_workflow.steps); gate_mode = 'flagged'; doc_types = @(); name = 'ECN' }) }
  return $out
}
# Doc types across the shared catalogue and every pillar's own list.
function Get-AllDocTypes { param($Config)
  $seen = @{}; $out = @()
  foreach ($d in @($Config.document_types) + @((Get-ProcessDefs $Config) | ForEach-Object { @($_.doc_types) })) {
    if ($d -and $d.doctype_id -and -not $seen.ContainsKey([string]$d.doctype_id)) { $seen[[string]$d.doctype_id] = $true; $out += ,$d }
  }
  return $out
}
function Get-ProcessDef { param($Config, [string]$ProcessId)
  foreach ($p in (Get-ProcessDefs $Config)) { if ([string]$p.process_id -eq $ProcessId) { return $p } }
  return $null
}
# Step keys are '<process_id>-<step_id>'; a process id may itself contain '-'.
function Get-StepDef { param($Config, [string]$StepKey)
  if (-not $StepKey) { return $null }
  $i = $StepKey.LastIndexOf('-')
  if ($i -lt 1) { return $null }
  $proc = Get-ProcessDef -Config $Config -ProcessId $StepKey.Substring(0, $i)
  if (-not $proc) { return $null }
  $sid = $StepKey.Substring($i + 1)
  foreach ($s in @($proc.steps)) { if ([string]$s.step_id -eq $sid) { return $s } }
  return $null
}
# Is this step a signed gate? 'all' = every step (NPI); 'flagged' = only steps
# with gate_clearance_required (ECN).
function Test-GatedStep { param($ProcessDef, $Step)
  if ([string]$ProcessDef.gate_mode -eq 'flagged') { return [bool]$Step.gate_clearance_required }
  return $true
}

function ConvertTo-UtcTime { param([string]$Value)
  if (-not $Value) { return $null }
  try { return [DateTime]::Parse($Value, [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::RoundtripKind).ToUniversalTime() } catch { return $null }
}

# R1 stale approvals. A signed gate is stale when an ACTIVE revision of one of
# its required documents (config-required or a per-model custom doc) was filed
# after the signature. Derived and read-only: the approval row is a historical
# fact and is never edited. Mirrors staleApprovalOf() in app.js - keep the two
# in step. Returns @{ 'project|step' = @{ docs = @(codes); approved_utc } }.
function Get-StaleApprovalMap { param($Config, $Approvals, $Deliverables)
  $latest = @{}
  foreach ($a in $Approvals) { $latest[[string]$a.project_id + '|' + [string]$a.step_key] = $a }
  $custom = @{}
  $active = @{}
  foreach ($d in $Deliverables) {
    $k = [string]$d.project_id + '|' + [string]$d.step_key
    if ($d.custom_doc -eq 'YES') { $custom[$k + '|' + [string]$d.doc_code] = $true }
    if ($d.is_active -ne 'YES') { continue }
    if (-not $active.ContainsKey($k)) { $active[$k] = New-Object System.Collections.Generic.List[object] }
    $active[$k].Add($d)
  }
  $out = @{}
  foreach ($k in @($latest.Keys)) {
    if (-not $active.ContainsKey($k)) { continue }
    $when = ConvertTo-UtcTime ([string]$latest[$k].approved_utc)
    if (-not $when) { continue }
    $step = Get-StepDef -Config $Config -StepKey ($k.Substring($k.IndexOf('|') + 1))
    $req = @{}
    if ($step) { foreach ($c in @($step.required_evidence_doctypes)) { if ($c) { $req[[string]$c] = $true } } }
    $late = @()
    foreach ($r in $active[$k]) {
      if (-not ($req.ContainsKey([string]$r.doc_code) -or $custom.ContainsKey($k + '|' + [string]$r.doc_code))) { continue }
      $tm = ConvertTo-UtcTime ([string]$r.uploaded_utc)
      if ($tm -and $tm -gt $when) { $late += [string]$r.doc_code }
    }
    if ($late.Count) { $out[$k] = @{ docs = $late; approved_utc = [string]$latest[$k].approved_utc } }
  }
  return $out
}

function New-ReportSheetXml { param([string]$Existing, [string[]]$RowsXml, [string]$Ns, [switch]$Append)
  $newContent = $RowsXml -join "`r`n"
  # Two shapes of template land here. A data-table sheet (the RANKED_COLORS
  # workbooks, LL_info's "List Issue") gets its rows REPLACED. A pre-built form
  # sheet - NPI_Trial_Report_Template has exactly one sheet and it is the
  # printed form - gets the generated block APPENDED underneath, because
  # replacing sheetData there would delete the form the report is named after.
  $keepExisting = [bool]$Append
  $result = [regex]::Replace($Existing,
    '(<(?:x:)?sheetData>)(.*?)(</(?:x:)?sheetData>)',
    {
      param($m)
      $kept = ''
      if ($keepExisting) { $kept = $m.Groups[2].Value }
      return $m.Groups[1].Value + $kept + "`r`n" + $newContent + "`r`n" + $m.Groups[3].Value
    },
    [System.Text.RegularExpressions.RegexOptions]::Singleline)
  return $result
}

# Replaces (or creates) one entry in an open ZipArchive.
function Set-ZipEntryText { param($Archive, [string]$Path, [string]$Text)
  $existing = $Archive.GetEntry($Path)
  if ($existing) { $existing.Delete() }
  $e = $Archive.CreateEntry($Path)
  $w = New-Object System.IO.StreamWriter($e.Open(), (New-Object System.Text.UTF8Encoding($false)))
  $w.Write($Text); $w.Close()
}
function Set-ZipEntryBytes { param($Archive, [string]$Path, [byte[]]$Bytes)
  $existing = $Archive.GetEntry($Path)
  if ($existing) { $existing.Delete() }
  $e = $Archive.CreateEntry($Path)
  $s = $e.Open()
  $s.Write($Bytes, 0, $Bytes.Length); $s.Close()
}

# Embeds LFI photos into a worksheet as real drawing objects, each anchored
# to a single top-left cell at its own natural size (v8.3) - no stretching
# or cell-fitting, unlike the two-cell "stretch to this box" anchor this
# replaced. $Slots gives one {fromCol, fromRow, toCol, toRow} per image
# position (0-based, as OpenXML counts them); toCol/toRow are no longer used
# for the anchor box itself (oneCellAnchor has none), only to keep computing
# where an overflow image (past the last slot) stacks below it. LL_info.xlsx
# ships with NO drawing infrastructure at all - no drawing part, no sheet
# rels, no image content types - so the whole chain is created here:
#   xl/media/*                       the image bytes
#   xl/drawings/drawing1.xml         the anchors
#   xl/drawings/_rels/...rels        anchor -> media
#   xl/worksheets/_rels/...rels      sheet  -> drawing
#   <drawing r:id> on the sheet      binds it in
#   [Content_Types].xml              declares png/jpeg and the drawing part
function Add-XlsxImageAnchors {
  param($Archive, [string]$SheetPath, [object[]]$Images, [object[]]$Slots)
  if (-not $Images -or $Images.Count -eq 0) { return }
  if (-not $Slots -or $Slots.Count -eq 0) { return }

  $anchors = New-Object System.Collections.Generic.List[string]
  $relsList = New-Object System.Collections.Generic.List[string]
  $exts = @{}
  # Height of the last slot, reused only to stack any overflow images beneath
  # the defined slots rather than dropping them or piling them on one another
  # - the anchor itself no longer has a box to size against.
  $lastSlot = $Slots[$Slots.Count - 1]
  $slotHeight = [int]$lastSlot.toRow - [int]$lastSlot.fromRow

  for ($i = 0; $i -lt $Images.Count; $i++) {
    $img = $Images[$i]
    $ext = ([string]$img.ext).ToLowerInvariant()
    if (-not $ext) { $ext = 'png' }
    $exts[$ext] = $true
    $mediaName = 'lfi_image' + ($i + 1) + '.' + $ext
    Set-ZipEntryBytes -Archive $Archive -Path ('xl/media/' + $mediaName) -Bytes $img.bytes

    if ($i -lt $Slots.Count) {
      $slot = $Slots[$i]
      $fromColI = [int]$slot.fromCol
      $top = [int]$slot.fromRow
    } else {
      # Overflow: reuse the first slot's column, one band lower each time.
      $slot = $Slots[0]
      $fromColI = [int]$slot.fromCol
      $overflowIdx = $i - $Slots.Count
      $top = [int]$lastSlot.toRow + 1 + ($overflowIdx * ($slotHeight + 1))
    }

    # Natural pixel size -> EMU (914400 EMU/inch over 96 px/inch = 9525
    # EMU/px, the standard OOXML/Excel assumption) - oneCellAnchor requires
    # its own explicit <xdr:ext>, there is no from/to box to imply one from,
    # so this is the one place a real width/height has to come from. Falls
    # back to a fixed 3in x 2in box if the bytes don't decode as an image
    # (corrupt upload) rather than aborting the whole XLSX write.
    $cx = 2743200; $cy = 1828800
    $ms = New-Object System.IO.MemoryStream(,$img.bytes)
    try {
      $bmp = [System.Drawing.Image]::FromStream($ms)
      try { $cx = [int]([math]::Round($bmp.Width * 9525)); $cy = [int]([math]::Round($bmp.Height * 9525)) }
      finally { $bmp.Dispose() }
    } catch { } finally { $ms.Dispose() }

    $rid = 'rIdImg' + ($i + 1)
    $anchors.Add(
      '<xdr:oneCellAnchor>' +
        '<xdr:from><xdr:col>' + $fromColI + '</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>' + $top + '</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>' +
        '<xdr:ext cx="' + $cx + '" cy="' + $cy + '" />' +
        '<xdr:pic>' +
          '<xdr:nvPicPr>' +
            '<xdr:cNvPr id="' + ($i + 2) + '" name="LFI Photo ' + ($i + 1) + '" descr="' + (ConvertTo-XmlSafe $img.name) + '" />' +
            '<xdr:cNvPicPr><a:picLocks noChangeAspect="1" /></xdr:cNvPicPr>' +
          '</xdr:nvPicPr>' +
          '<xdr:blipFill><a:blip r:embed="' + $rid + '" /><a:stretch><a:fillRect /></a:stretch></xdr:blipFill>' +
          '<xdr:spPr><a:xfrm><a:off x="0" y="0" /><a:ext cx="' + $cx + '" cy="' + $cy + '" /></a:xfrm><a:prstGeom prst="rect"><a:avLst /></a:prstGeom></xdr:spPr>' +
        '</xdr:pic>' +
        '<xdr:clientData />' +
      '</xdr:oneCellAnchor>')
    $relsList.Add('<Relationship Id="' + $rid + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/' + $mediaName + '" />')
  }

  $drawingXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    ($anchors -join '') + '</xdr:wsDr>'
  Set-ZipEntryText -Archive $Archive -Path 'xl/drawings/drawing1.xml' -Text $drawingXml

  $drawingRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + ($relsList -join '') + '</Relationships>'
  Set-ZipEntryText -Archive $Archive -Path 'xl/drawings/_rels/drawing1.xml.rels' -Text $drawingRels

  # Sheet -> drawing relationship. Preserve any rels the sheet already has.
  $sheetName = $SheetPath.Substring($SheetPath.LastIndexOf('/') + 1)
  $sheetRelsPath = 'xl/worksheets/_rels/' + $sheetName + '.rels'
  $sheetRelsEntry = $Archive.GetEntry($sheetRelsPath)
  $drawingRelId = 'rIdDrawing1'
  if ($sheetRelsEntry) {
    $rd = New-Object System.IO.StreamReader($sheetRelsEntry.Open())
    $sheetRelsXml = $rd.ReadToEnd(); $rd.Close()
    if ($sheetRelsXml -notmatch [regex]::Escape($drawingRelId)) {
      $sheetRelsXml = $sheetRelsXml -replace '</Relationships>',
        ('<Relationship Id="' + $drawingRelId + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml" /></Relationships>')
    }
  } else {
    $sheetRelsXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="' + $drawingRelId + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml" />' +
      '</Relationships>'
  }
  Set-ZipEntryText -Archive $Archive -Path $sheetRelsPath -Text $sheetRelsXml

  # Bind the drawing into the sheet itself.
  $sheetEntry = $Archive.GetEntry($SheetPath)
  if ($sheetEntry) {
    $sr = New-Object System.IO.StreamReader($sheetEntry.Open())
    $sheetXml = $sr.ReadToEnd(); $sr.Close()
    if ($sheetXml -notmatch '<drawing\s') {
      # r: is not declared on this template's <worksheet> root, and r:id
      # without its namespace makes Excel reject the file outright.
      if ($sheetXml -notmatch 'xmlns:r=') {
        $sheetXml = [regex]::Replace($sheetXml, '(<worksheet\b[^>]*?)(>)',
          '$1 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"$2', 1)
      }
      # <drawing> is last in the CT_Worksheet sequence, so it goes immediately
      # before the closing tag - after pageSetup, which this template has.
      $sheetXml = $sheetXml -replace '</worksheet>', ('<drawing r:id="' + $drawingRelId + '" /></worksheet>')
      Set-ZipEntryText -Archive $Archive -Path $SheetPath -Text $sheetXml
    }
  }

  # Content types: image extensions + the drawing part.
  $ctEntry = $Archive.GetEntry('[Content_Types].xml')
  if ($ctEntry) {
    $cr = New-Object System.IO.StreamReader($ctEntry.Open())
    $ctXml = $cr.ReadToEnd(); $cr.Close()
    $add = ''
    foreach ($ext in $exts.Keys) {
      if ($ctXml -notmatch ('Extension="' + $ext + '"')) {
        $mime = if ($ext -eq 'png') { 'image/png' } else { 'image/jpeg' }
        $add += '<Default Extension="' + $ext + '" ContentType="' + $mime + '" />'
      }
    }
    if ($ctXml -notmatch '/xl/drawings/drawing1\.xml') {
      $add += '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml" />'
    }
    if ($add) {
      $ctXml = $ctXml -replace '</Types>', ($add + '</Types>')
      Set-ZipEntryText -Archive $Archive -Path '[Content_Types].xml' -Text $ctXml
    }
  }
}

function Get-SheetMaxRow { param([string]$SheetXml)
  # Appended rows need r= numbers past everything the template already uses;
  # duplicate row indexes make Excel declare the file unreadable and repair it.
  $max = 0
  foreach ($m in [regex]::Matches($SheetXml, '<(?:x:)?row\s[^>]*\br="(\d+)"')) {
    $n = [int]$m.Groups[1].Value
    if ($n -gt $max) { $max = $n }
  }
  return $max
}

function Get-ReportData {
  param([string]$Type, [string]$FamFilter, [string]$ModelFilter, [string]$StartFilter, [string]$EndFilter)

  $config = Get-Config
  $nowWeek = Get-NowWeek

  # The dashboard slicers are multi-select (v4.1), so each filter arrives as a
  # comma-separated list. Compared as a single literal, "A,B" matched nothing
  # and a two-value slicer selection silently produced an empty report.
  function Convert-FilterSet { param([string]$Raw)
    if (-not $Raw) { return $null }
    $set = @{}
    foreach ($v in ($Raw -split ',')) {
      $t = $v.Trim()
      if ($t) { $set[$t] = $true }
    }
    if ($set.Count -eq 0) { return $null }
    return $set
  }
  $famSet   = Convert-FilterSet $FamFilter
  $modelSet = Convert-FilterSet $ModelFilter
  $startSet = Convert-FilterSet $StartFilter
  $endSet   = Convert-FilterSet $EndFilter

  $projects = @(Read-Store 'lb_projects')
  if ($famSet)   { $projects = @($projects | Where-Object { $famSet.ContainsKey([string]$_.prod_family) }) }
  if ($modelSet) { $projects = @($projects | Where-Object { $modelSet.ContainsKey([string]$_.family) }) }
  if ($startSet) { $projects = @($projects | Where-Object { $startSet.ContainsKey([string](ConvertTo-IsoWeek $_.prf_date)) }) }
  if ($endSet)   { $projects = @($projects | Where-Object { $endSet.ContainsKey([string](ConvertTo-IsoWeek $_.target_date)) }) }

  # Pre-read stores for per-project computation
  $allApprovals   = @(Read-Store 'lb_approvals')
  $allBypasses    = @(Read-Store 'lb_bypasses')
  $allIssues      = @(Read-Store 'lb_issues')
  $allSpIssues    = @(Read-Store 'lb_sp_issues')
  $allDeliverables = @(Read-Store 'lb_deliverables')
  $staleMap = Get-StaleApprovalMap -Config $config -Approvals $allApprovals -Deliverables $allDeliverables

  # Build progress cache: project_id -> { pct, done, total, complete, missingDocs }
  $progressCache = @{}
  foreach ($p in $projects) {
    $proc = $p.process
    # $config has no "step_models" key — the real step lists live under
    # npi_workflow.steps / ecn_workflow.steps (see lines ~1332-1334 below for
    # the same lookup). The old path silently resolved to $null, so $total
    # was always 0 and every report's Completion % was always 0.
    $pdef = Get-ProcessDef -Config $config -ProcessId $proc
    $steps = if ($pdef) { @($pdef.steps) } else { @() }
    $gated = @($steps | Where-Object { Test-GatedStep $pdef $_ })
    $total = $gated.Count
    $done = 0
    $missingDocs = 0
    $staleGates = 0
    foreach ($step in $gated) {
      $sk = "$proc-$($step.step_id)"
      $appr = @($allApprovals | Where-Object { $_.project_id -eq $p.project_id -and $_.step_key -eq $sk })
      $byp  = @($allBypasses  | Where-Object { $_.project_id -eq $p.project_id -and $_.step_key -eq $sk -and -not $_.closed_utc })
      if ($appr.Count -gt 0 -or $byp.Count -gt 0) { $done++ }
      if ($appr.Count -gt 0 -and $staleMap.ContainsKey($p.project_id + '|' + $sk)) { $staleGates++ }
      # Required-doc count comes from required_evidence_doctypes only —
      # conditional_evidence_doctypes don't block the gate, so they don't
      # count as "missing" here either.
      foreach ($code in @($step.required_evidence_doctypes)) {
        $filed = @($allDeliverables | Where-Object {
          $_.project_id -eq $p.project_id -and $_.step_key -eq $sk -and $_.doc_code -eq $code -and
          $_.status -ne 'Removed' -and ($_.file_name -or $_.link_url -or $_.approved -eq 'YES')
        })
        if ($filed.Count -eq 0) { $missingDocs++ }
      }
    }
    $pct = if ($total -gt 0) { [Math]::Round(100 * $done / $total) } else { 0 }
    $complete = ($done -eq $total -and $total -gt 0)
    $progressCache[$p.project_id] = @{ pct = $pct; done = $done; total = $total; complete = $complete; missingDocs = $missingDocs; staleGates = $staleGates }
  }

  if ($Type -eq 'lfi') {
    # Column order (A-L) is fixed by Template_EPM_Issue_Analytics_RANKED_
    # COLORS.xlsx's Dashboard formulas: COUNTA(E) total, COUNTIF(D,"<step
    # name>") gate ranking + the "late-stage issues" cards, COUNTIF(C,<model>)
    # model ranking, COUNTIF(H,"Critical") severity card, COUNTIF(K,<"YYYY-
    # MM">) peak-month ranking, COUNTIF(L,"Open") open-issue card. Everything
    # past L is free.
    $projLookup = @{}
    foreach ($p in $projects) { $projLookup[$p.project_id] = $p }
    $issues = @($allIssues | Where-Object { $projLookup.ContainsKey($_.project_id) })
    $headers = @('Issue ID','Project ID','Model','Gate','Raised UTC','Raised By','Category','Severity',
      'Description','Owner','Month','Status','Due Date','Resolution','Closed UTC')
    # @($headers) SPLATS the header array into N separate scalar elements,
    # so each column name renders as its own one-cell row and the real data
    # gets pushed down past it. The unary comma keeps it as ONE row.
    $rows = @(,$headers)
    foreach ($row in $issues) {
      $proj = $projLookup[$row.project_id]
      $gate = Get-StepName -StepKey $row.step_key -Config $config
      $month = ''
      try { $month = ([datetime]::Parse($row.raised_utc)).ToString('yyyy-MM') } catch { }
      $severity = if ($row.severity) { $row.severity } else { 'Major' }
      $rows += ,@(
        $row.issue_id, $row.project_id, $proj.family, $gate, $row.raised_utc, $row.raised_by,
        $row.category, $severity, $row.description, $row.owner, $month, $row.status, $row.due_date,
        $row.resolution, $row.closed_utc
      )
    }
    # ,$rows - NOT $rows. PowerShell unwraps a single-element array on
    # return, so a report with zero data rows hands the caller the header
    # array's strings as N scalars and transposes the whole sheet.
    return ,$rows
  }
  elseif ($Type -eq 'transfer') {
    # Column order (A-L) is NOT cosmetic — Template_ProjectTransfer_Report_
    # RANKED_COLORS.xlsx's Dashboard sheet has hardcoded formulas reading
    # specific letters (AVERAGE(Data!G2:G1000) for progress, SUM(Data!H/I) for
    # gates done/total, SUM(Data!J/K) for missing docs/open issues, COUNTIF on
    # Data!L against "On Track"/"At Risk"/"Late"/"Complete"). Everything past
    # L is free — the template never references it.
    $headers = @('Project ID','Process','Model','Product Family','Change Class','PRF Date',
      'Progress','Gates Completed','Total Gates','Missing Docs','Open Issues','Status',
      'Target Date','Market Manager','Country','Customer Number','Project Status','Notes','Stale Approvals')
    # @($headers) SPLATS the header array into N separate scalar elements,
    # so each column name renders as its own one-cell row and the real data
    # gets pushed down past it. The unary comma keeps it as ONE row.
    $rows = @(,$headers)
    foreach ($p in $projects) {
      $pr = $progressCache[$p.project_id]
      $targetWeek = ConvertTo-IsoWeek $p.target_date
      $openCount = @($allIssues | Where-Object { $_.project_id -eq $p.project_id -and $_.status -ne 'Closed' }).Count
      $openCount += @($allSpIssues | Where-Object { $_.project_id -eq $p.project_id -and $_.status -ne 'Closed' }).Count
      $status = Get-TransferStatus -Complete $pr.complete -TargetWeek $targetWeek -NowWeek $nowWeek
      $rows += ,@(
        $p.project_id, $p.process, $p.family, $p.prod_family, $p.class_abcde, $p.prf_date,
        (ConvertTo-PctFraction $pr.pct), [string]$pr.done, [string]$pr.total, [string]$pr.missingDocs, [string]$openCount, $status,
        $p.target_date, $p.market_manager, $p.country, $p.customer_number, $p.status, $p.notes, [string]$pr.staleGates
      )
    }
    # ,$rows - NOT $rows. PowerShell unwraps a single-element array on
    # return, so a report with zero data rows hands the caller the header
    # array's strings as N scalars and transposes the whole sheet.
    return ,$rows
  }
  elseif ($Type -eq 'kpi') {
    # Column order (A-E) is fixed by Template_KPI_Report_RANKED_COLORS.xlsx's
    # Dashboard formulas: COUNTA(A), AVERAGE(B) "Average Target", AVERAGE(C)
    # "Average Actual", AVERAGE(D) "Average Variance", COUNTIF(E,"On
    # Target"/"Watch"/"Off Target"). The KPI here is "finish every gate by
    # its target week" — Target is always 100% complete, Actual is the real
    # completion fraction, Variance is Actual-Target (<=0 until Complete),
    # Status reuses the same On Track/At Risk/Late/Complete classification as
    # the Transfer report, collapsed to the 3 labels this template expects.
    $headers = @('Project ID','Process','Model','Product Family','Target Week',
      'Target','Actual','Variance','Status','Open Issues')
    # @($headers) SPLATS the header array into N separate scalar elements,
    # so each column name renders as its own one-cell row and the real data
    # gets pushed down past it. The unary comma keeps it as ONE row.
    $rows = @(,$headers)
    $target = 1.0
    foreach ($p in $projects) {
      $pr = $progressCache[$p.project_id]
      $targetWeek = ConvertTo-IsoWeek $p.target_date
      if (-not $targetWeek) { $targetWeek = '' }
      $openCount = @($allIssues | Where-Object { $_.project_id -eq $p.project_id -and $_.status -ne 'Closed' }).Count
      $openCount += @($allSpIssues | Where-Object { $_.project_id -eq $p.project_id -and $_.status -ne 'Closed' }).Count
      $actual = [double]$pr.pct / 100.0
      $variance = $actual - $target
      $transferStatus = Get-TransferStatus -Complete $pr.complete -TargetWeek $targetWeek -NowWeek $nowWeek
      $kpiStatus = switch ($transferStatus) {
        'Complete' { 'On Target' }
        'On Track' { 'On Target' }
        'At Risk'  { 'Watch' }
        'Late'     { 'Off Target' }
        default    { 'Watch' }
      }
      $rows += ,@(
        $p.project_id, $p.process, $p.family, $p.prod_family, $targetWeek,
        (ConvertTo-PctFraction ($target * 100)), (ConvertTo-PctFraction $pr.pct),
        $variance.ToString('0.####', [System.Globalization.CultureInfo]::InvariantCulture),
        $kpiStatus, [string]$openCount
      )
    }
    # ,$rows - NOT $rows. PowerShell unwraps a single-element array on
    # return, so a report with zero data rows hands the caller the header
    # array's strings as N scalars and transposes the whole sheet.
    return ,$rows
  }
  elseif ($Type -eq 'll') {
    # Lessons Learnt log. Same source store as 'lfi' (the LFI modal appends to
    # lb_issues) but laid out to match LL_info.xlsx's "List Issue" sheet, which
    # reads as a numbered incident register rather than a raw table dump.
    $projLookup = @{}
    foreach ($p in $projects) { $projLookup[$p.project_id] = $p }
    $issues = @($allIssues | Where-Object { $projLookup.ContainsKey($_.project_id) })
    $headers = @('No.','Date','Model','Project ID','Step','Issue Title / Description','Category','Root Cause / Resolution','Owner','Due Date','Status','Closed UTC')
    $rows = @(,$headers)
    $n = 0
    foreach ($row in $issues) {
      $n++
      $proj = $projLookup[$row.project_id]
      $raised = [string]$row.raised_utc
      if ($raised.Length -ge 10) { $raised = $raised.Substring(0, 10) }
      $rows += ,@(
        [string]$n, $raised, [string]$proj.family, $row.project_id, $row.step_key,
        $row.description, $row.category, $row.resolution, $row.owner,
        $row.due_date, $row.status, $row.closed_utc
      )
    }
    return ,$rows
  }
  elseif ($Type -eq 'trial') {
    # NPI trial production summary. Appended UNDER the printed form sheet, so
    # it leads with its own caption row - without one the block reads as stray
    # data glued to the bottom of somebody's trial report.
    $rows = @(,@('NPI TRIAL PRODUCTION SUMMARY - generated ' + (Get-Date -Format 'yyyy-MM-dd HH:mm')))
    $rows += ,@('Project ID','Process','Model','Product Family','Change Class','PRF Date','Target Date','Target Week','Gates Signed','Gates Total','Completion %','Open Issues','Status')
    foreach ($p in $projects) {
      $pr = $progressCache[$p.project_id]
      $targetWeek = ConvertTo-IsoWeek $p.target_date
      if (-not $targetWeek) { $targetWeek = '' }
      $openCount = @($allIssues | Where-Object { $_.project_id -eq $p.project_id -and $_.status -ne 'Closed' }).Count
      $openCount += @($allSpIssues | Where-Object { $_.project_id -eq $p.project_id -and $_.status -ne 'Closed' }).Count
      $rows += ,@(
        $p.project_id, $p.process, $p.family, $p.prod_family, $p.class_abcde,
        $p.prf_date, $p.target_date, $targetWeek,
        [string]$pr.done, [string]$pr.total, (ConvertTo-PctFraction $pr.pct), [string]$openCount, $p.status
      )
    }
    return ,$rows
  }
  return @()
}

# ---------------------------------------------------- v11 R3 vault index --
# One entry per document that has at least one revision (or is marked
# Removed), with its active revision inline. Cached until a contributing
# store (deliverables, projects, approvals) or config changes.
$script:VaultIndexCache = @{ sig = ''; docs = @() }
# v11.1 - guesses a stray vault file's project/doc/part from where it
# ALREADY sits, when that location matches Save-Evidence's own folder
# pattern ([Family]\[DocType]\[Part]\file or [Family]\[DocType]\file). Lets
# the Input tab offer a one-click "looks like X - confirm?" instead of a
# blank form for the common case: a file dragged into the right folder by
# hand instead of through the app. Returns $null when the path does not
# look like the pattern at all, or the DocType segment is not a real one.
function Get-OrphanGuess {
  param($Config, [string]$RelPath)
  $parts = @($RelPath -split '\\')
  # v12: the folder levels are whatever the admin set, so the guess reads the
  # path against that list instead of assuming [Model]\[DocType]\[PartID]. A
  # blank level is dropped when a file is saved, so the list is also tried
  # without [PartID]. Only a level that is exactly one token can be read back;
  # a level that mixes tokens and text ("[Process] docs") is skipped over.
  $levels = @(Get-EvidenceLevels $Config)
  $dirs = @(if ($parts.Count -gt 1) { $parts[0..($parts.Count - 2)] })
  $map = $null
  foreach ($cand in @(, $levels) + @(, @($levels | Where-Object { $_ -ne '[PartID]' }))) {
    if ($cand.Count -ne $dirs.Count -or -not $cand.Count) { continue }
    $map = @{}
    for ($i = 0; $i -lt $cand.Count; $i++) { if ($cand[$i] -match '^\[([A-Za-z]+)\]$') { $map[$Matches[1]] = $dirs[$i] } }
    break
  }
  if (-not $map -or -not $map.ContainsKey('DocType')) { return $null }
  $family = [string]$map['Model']
  $docCode = ([string]$map['DocType']).ToUpperInvariant()
  $part = [string]$map['PartID']
  $dt = @(Get-AllDocTypes $Config) | Where-Object { ([string]$_.doctype_id).ToUpperInvariant() -eq $docCode } | Select-Object -First 1
  if (-not $dt) { return $null }
  $projects = @(Read-Store 'lb_projects' | Where-Object {
    ($map.ContainsKey('ProjectID') -and (Get-SafeName ([string]$_.project_id)) -eq $map['ProjectID']) -or
    (-not $map.ContainsKey('ProjectID') -and $family -and [string]$_.family -eq $family)
  })
  if (-not $family -and $projects.Count -eq 1) { $family = [string]$projects[0].family }
  if (-not $projects.Count) { return $null }
  $ambiguous = $projects.Count -gt 1
  $projectId = if (-not $ambiguous) { [string]$projects[0].project_id } else { '' }
  $stepKey = ''
  if (-not $ambiguous) {
    $pdef = Get-ProcessDef -Config $Config -ProcessId ([string]$projects[0].process)
    if ($pdef) {
      foreach ($s in @($pdef.steps)) {
        if ((@($s.required_evidence_doctypes) + @($s.conditional_evidence_doctypes)) -contains [string]$dt.doctype_id) { $stepKey = [string]$projects[0].process + '-' + [string]$s.step_id; break }
      }
    }
  }
  return @{
    family = $family; doc_code = [string]$dt.doctype_id; doc_name = [string]$dt.name; part_id = $part
    project_id = $projectId; step_key = $stepKey
    ambiguous_projects = @($projects | ForEach-Object { [string]$_.project_id })
    confident = [bool]($projectId -and $stepKey)
  }
}

function Get-VaultIndex { param($Config)
  # Signature first (Get-MergedStore is cheap when nothing changed), so a
  # 15 s poll with unchanged data never re-materialises a single row.
  foreach ($s in @('lb_deliverables', 'lb_projects', 'lb_approvals', 'lb_bypasses')) { [void](Get-MergedStore $s) }
  $cfgStamp = ''
  try { $ci = Get-Item -LiteralPath $ConfigPath; $cfgStamp = [string]$ci.Length + '|' + [string]$ci.LastWriteTimeUtc.Ticks } catch { }
  $sig = ((@('lb_deliverables', 'lb_projects', 'lb_approvals', 'lb_bypasses') | ForEach-Object { [string]$script:MergeCache[$_].sig }) -join '#') + '#' + $cfgStamp
  if ($script:VaultIndexCache.sig -eq $sig) { return $script:VaultIndexCache.docs }
  $delivs = @(Read-Store 'lb_deliverables')
  $projects = @(Read-Store 'lb_projects')
  $approvals = @(Read-Store 'lb_approvals')
  $bypasses = @(Read-Store 'lb_bypasses')
  $projById = @{}; foreach ($pr in $projects) { $projById[[string]$pr.project_id] = $pr }
  $docInfo = @{}; foreach ($dt in (Get-AllDocTypes $Config)) { $docInfo[[string]$dt.doctype_id] = $dt }
  $stale = Get-StaleApprovalMap -Config $Config -Approvals $approvals -Deliverables $delivs
  # v11.1: a step whose gate is signed (or bypassed and still open) promotes
  # every document filed under it from "Filed" to "Approved" - the same rule
  # cellStateFor() applies client-side (an approved gate promotes filed to
  # done). Vault had never carried this before; every document read either
  # "Active" or "Removed" regardless of whether anyone had actually signed
  # off on it, which is the bug the naming asked to fix.
  $gateDone = @{}
  foreach ($a in $approvals) { $gateDone[[string]$a.project_id + '|' + [string]$a.step_key] = $true }
  foreach ($b in $bypasses) { if (-not $b.closed_utc) { $gateDone[[string]$b.project_id + '|' + [string]$b.step_key] = $true } }
  $groups = New-Object 'System.Collections.Generic.Dictionary[string,object]' ([StringComparer]::Ordinal)
  $order = New-Object System.Collections.Generic.List[string]
  foreach ($r in $delivs) {
    # v11.1: part_id joins the key - see Set-DerivedRevisions for why. Each
    # BOM part filed under the same doc_code becomes its own Vault row.
    $k = [string]$r.project_id + '|' + [string]$r.step_key + '|' + [string]$r.doc_code + '|' + [string]$r.part_id
    if (-not $groups.ContainsKey($k)) { $groups[$k] = @{ revs = 0; active = $null; removed = $false }; $order.Add($k) }
    $g = $groups[$k]
    if ($r.status -eq 'Removed') { $g.removed = $true }
    if ($r.revision_no) { $g.revs++; if ($r.is_active -eq 'YES') { $g.active = $r } }
  }
  $docs = New-Object System.Collections.Generic.List[object]
  foreach ($k in $order) {
    $g = $groups[$k]
    if (-not $g.active -and -not $g.removed) { continue }
    $parts = $k.Split('|')
    $pr = $projById[$parts[0]]
    $a = $g.active
    $dt = $docInfo[$parts[2]]
    $st = Get-StepDef -Config $Config -StepKey $parts[1]
    $staleEntry = $stale[$parts[0] + '|' + $parts[1]]
    $isStale = [bool]($staleEntry -and (@($staleEntry.docs) -contains $parts[2]))
    $status = if ($g.removed) { 'Removed' }
              elseif ($gateDone.ContainsKey($parts[0] + '|' + $parts[1])) { 'Approved' }
              else { 'Filed' }
    $o = @{
      project_id = $parts[0]; step_key = $parts[1]; doc_code = $parts[2]; part_id = $parts[3]
      process = if ($pr) { [string]$pr.process } else { ($parts[1] -replace '-[^-]*$', '') }
      family = if ($pr) { [string]$pr.family } else { '' }
      prod_family = if ($pr) { [string]$pr.prod_family } else { '' }
      step_name = if ($st) { [string]$st.step_name } else { '' }
      doc_name = if ($dt) { [string]$dt.name } else { $parts[2] }
      owner_dept = if ($dt) { [string]$dt.owner_dept } else { '' }
      status = $status
      revisions = $g.revs
      rev = if ($a) { [string]$a.revision_no } else { '' }
      pic = if ($a) { [string]$a.uploaded_by } else { '' }
      date = if ($a) { [string]$a.uploaded_utc } else { '' }
      deliverable_id = if ($a) { [string]$a.deliverable_id } else { '' }
      file_name = if ($a) { [string]$a.file_name } else { '' }
      file_path = if ($a) { [string]$a.file_path } else { '' }
      kind = if ($a) { [string]$a.kind } else { '' }
      link_url = if ($a) { [string]$a.link_url } else { '' }
      change_reason = if ($a) { [string]$a.change_reason } else { '' }
      stale = $isStale
    }
    $o.search = (@($o.project_id, $o.doc_code, $o.doc_name, $o.file_name, $o.family, $o.step_name, $o.pic, $o.part_id,
      $(if ($a) { [string]$a.original_name + ' ' + [string]$a.description } else { '' })) -join ' ').ToLowerInvariant()
    $docs.Add($o)
  }
  # newest active revision first
  $arr = $docs.ToArray()
  $keys = New-Object 'string[]' $arr.Length
  for ($i = 0; $i -lt $arr.Length; $i++) { $keys[$i] = ([string]$arr[$i].date).PadRight(40) + '|' + $i.ToString('D9') }
  [Array]::Sort($keys, [StringComparer]::Ordinal)
  $sorted = New-Object System.Collections.Generic.List[object]
  for ($i = $keys.Length - 1; $i -ge 0; $i--) { $sorted.Add($arr[[int]$keys[$i].Substring($keys[$i].Length - 9)]) }
  $script:VaultIndexCache = @{ sig = $sig; docs = $sorted }
  return $sorted
}

# ------------------------------------------------ v11 R4 pillar validation --
# Returns error strings; empty = the whole list is acceptable.
function Test-PillarList { param($Config, $Pillars)
  $errs = @()
  if (-not $Pillars -or -not @($Pillars).Count) { return @('At least one pillar is required.') }
  $seen = @{}
  $shared = @{}; foreach ($d in @($Config.document_types)) { $shared[[string]$d.doctype_id] = $true }
  $pillarDocs = @{}
  foreach ($pl in @($Pillars)) {
    $id = [string]$pl.process_id
    if ($id -notmatch '^[A-Z][A-Z0-9_]{1,15}$') { $errs += ("Pillar id '" + $id + "' must be 2-16 characters: capital letters, digits or _ (it prefixes project IDs and step keys)."); continue }
    if ($seen.ContainsKey($id)) { $errs += ("Pillar id '" + $id + "' is used twice."); continue }
    $seen[$id] = $true
    if (-not ([string]$pl.name).Trim()) { $errs += ("Pillar " + $id + ": a display name is required.") }
    if ($pl.gate_mode -and @('all', 'flagged') -notcontains [string]$pl.gate_mode) { $errs += ("Pillar " + $id + ": gate_mode must be 'all' or 'flagged'.") }
    foreach ($d in @($pl.doc_types)) {
      if (-not $d) { continue }
      $did = [string]$d.doctype_id
      if (-not $did -or -not ([string]$d.name).Trim()) { $errs += ("Pillar " + $id + ": every document type needs an id and a name."); continue }
      if ($shared.ContainsKey($did)) { $errs += ("Pillar " + $id + ": document type '" + $did + "' already exists in the shared catalogue - reference it instead of redefining it.") }
      elseif ($pillarDocs.ContainsKey($did)) { $errs += ("Document type '" + $did + "' is defined by two pillars.") }
      $pillarDocs[$did] = $true
    }
    if ($pl.workflow) {
      if (-not $Config.([string]$pl.workflow)) { $errs += ("Pillar " + $id + ": workflow '" + [string]$pl.workflow + "' does not exist in config.json.") }
      continue
    }
    $steps = @($pl.steps)
    if (-not $steps.Count) { $errs += ("Pillar " + $id + ": at least one step is required."); continue }
    $sids = @{}
    foreach ($s in $steps) {
      $sid = 0
      if (-not [int]::TryParse([string]$s.step_id, [ref]$sid) -or $sid -lt 1) { $errs += ("Pillar " + $id + ": step ids must be whole numbers from 1."); continue }
      if ($sids.ContainsKey($sid)) { $errs += ("Pillar " + $id + ": step " + $sid + " appears twice.") }
      $sids[$sid] = $true
      if (-not ([string]$s.step_name).Trim()) { $errs += ("Pillar " + $id + ": step " + $sid + " needs a name.") }
    }
  }
  # every document code a step asks for must exist somewhere
  foreach ($pl in @($Pillars)) {
    if ($pl.workflow) { continue }
    foreach ($s in @($pl.steps)) {
      foreach ($code in @($s.required_evidence_doctypes) + @($s.conditional_evidence_doctypes)) {
        if ($code -and -not $shared.ContainsKey([string]$code) -and -not $pillarDocs.ContainsKey([string]$code)) {
          $errs += ("Pillar " + [string]$pl.process_id + ", step " + [string]$s.step_id + ": document type '" + [string]$code + "' is not defined (shared catalogue or this pillar's own types).")
        }
      }
    }
  }
  # a pillar that still has projects cannot disappear
  $kept = @{}; foreach ($pl in @($Pillars)) { $kept[[string]$pl.process_id] = $true }
  $orphaned = @{}
  foreach ($pr in @(Read-Store 'lb_projects')) { if (-not $kept.ContainsKey([string]$pr.process)) { $orphaned[[string]$pr.process] = 1 + [int]$orphaned[[string]$pr.process] } }
  foreach ($k in $orphaned.Keys) { $errs += ("Pillar " + $k + " cannot be removed: " + $orphaned[$k] + " project(s) use it.") }
  return $errs
}

# ------------------------------------------------------ v11 R1 backfill --
# One-time, run with every PC's app stopped:
#   powershell -File system\launcher.ps1 -Backfill          (dry run: report only)
#   powershell -File system\launcher.ps1 -Backfill -Apply   (backup + write)
# Revision numbers and the active flag are DERIVED on every read, so the app is
# correct without this. The backfill only writes those derived values into the
# base lb_deliverables.csv, so the raw CSV also reads correctly in Excel.
if ($Backfill) {
  $merged  = Get-MergedStore 'lb_deliverables'
  $derived = @(Read-Store 'lb_deliverables')
  $byId = @{}
  foreach ($r in $derived) { $byId[[string]$r.deliverable_id] = $r }
  $real = @($derived | Where-Object { $_.revision_no })
  $docs = @{}
  foreach ($r in $real) { $k = $r.project_id + '|' + $r.step_key + '|' + $r.doc_code; $docs[$k] = 1 + [int]$docs[$k] }
  # Cross-check against pre-v11 evidenceFor(): the LAST real row per document
  # in file order must be the one marked active.
  $lastWins = @{}
  foreach ($r in $derived) { if ($r.file_name -or $r.link_url -or $r.file_path) { $lastWins[$r.project_id + '|' + $r.step_key + '|' + $r.doc_code] = [string]$r.deliverable_id } }
  $mismatch = @($lastWins.Keys | Where-Object { $byId[$lastWins[$_]].is_active -ne 'YES' })
  $multi = @($docs.Keys | Where-Object { $docs[$_] -gt 1 } | Sort-Object)
  $mode = if ($Apply) { 'APPLY' } else { 'DRY RUN' }
  $mm = if ($mismatch.Count) { '  <-- ' + ($mismatch -join ', ') } else { '  (none - day one shows no change)' }
  $lines = @(
    ('v11 revision backfill - ' + $mode + ' - ' + (Get-Date -Format 's')),
    ('rows in lb_deliverables           : ' + $derived.Count),
    ('revision rows (file/path/link)    : ' + $real.Count),
    ('marker rows (claim/custom/removed): ' + ($derived.Count - $real.Count) + '  - never numbered'),
    ('documents                         : ' + $docs.Count),
    ('documents with >1 revision        : ' + $multi.Count),
    ('active differs from last-row-wins : ' + $mismatch.Count + $mm),
    '',
    'documents with several revisions:'
  )
  foreach ($k in $multi) {
    $lines += ('  ' + $k)
    foreach ($r in @($real | Where-Object { ($_.project_id + '|' + $_.step_key + '|' + $_.doc_code) -eq $k })) {
      $act = if ($r.is_active -eq 'YES') { '  ACTIVE' } else { '' }
      $lines += ('    rev ' + $r.revision_no + '  ' + $r.deliverable_id + '  ' + $r.uploaded_utc + '  ' + $r.uploaded_by + $act)
    }
  }
  $journals = @(if (Test-Path -LiteralPath $JournalRoot) { Get-ChildItem -LiteralPath $JournalRoot -Recurse -Filter '*.csv' })
  if ($Apply) {
    if ($mismatch.Count) { $lines += 'REFUSED: the active revision would differ from last-row-wins - investigate first.' }
    elseif ($journals.Count) { $lines += ('REFUSED: ' + $journals.Count + ' journal file(s) exist. The backfill is a pre-rollout step; the running app already derives these values.') }
    else {
      $bk = Join-Path $SystemDir ('tracking_backup_v11_' + (Get-Date -Format 'yyyyMMdd_HHmmss'))
      Copy-Item -LiteralPath $TrackingDir -Destination $bk -Recurse
      $cols = $Stores['lb_deliverables']
      $sb = New-Object System.Text.StringBuilder
      [void]$sb.Append(($cols -join ',')); [void]$sb.Append("`r`n")
      foreach ($o in $merged.list) {
        $d = $byId[[string]$o['deliverable_id']]
        $cells = foreach ($c in $cols) {
          $v = if ((@('revision_no', 'is_active', 'superseded_utc') -contains $c) -and $d) { [string]$d.$c } else { [string]$o[$c] }
          ConvertTo-CsvCell $v
        }
        [void]$sb.Append(($cells -join ',')); [void]$sb.Append("`r`n")
      }
      $outText = $sb.ToString()
      Invoke-Locked -Path (CsvPath 'lb_deliverables') -Action { param($s) Write-AllText $s $outText }.GetNewClosure() | Out-Null
      Set-Content -LiteralPath $SealPath -Value ([DateTime]::UtcNow.ToString('o')) -Encoding ASCII
      $lines += ('APPLIED. Backup of tracking\ : ' + $bk)
    }
  }
  $report = Join-Path $LogDir ('v11_backfill_' + (Get-Date -Format 'yyyyMMdd_HHmmss') + '.txt')
  Set-Content -LiteralPath $report -Value $lines -Encoding UTF8
  $lines | ForEach-Object { Write-Output $_ }
  Write-Output ('Report: ' + $report)
  exit 0
}

# ================================================================ v12 auth ==
# Before v12 the tool had no login: identity was a name picked from a header
# dropdown, "admin" was gated by a PIN kept in plain text in config.json, and
# every write trusted the `user` field the browser sent. v12 replaces that:
#   - a separate login page (login.html) and a server-side session held in an
#     HttpOnly cookie. Every /api/* route except /api/auth/* and /api/shutdown
#     needs a session, and Read-JsonBody overwrites the `user` a request claims
#     with the session's own name, so nobody can act under another name.
#   - passwords are stored only as salted PBKDF2-HMAC-SHA256 hashes, one small
#     file per user under system\auth\ (one file per user, not one shared file,
#     so two people changing their passwords on two PCs never collide in the
#     OneDrive sync).
#   - sessions live in this process's memory. Each PC runs its own launcher on
#     loopback, so a session is local to the PC it was opened on and ends when
#     this launcher stops.
# What this is NOT: the app folder is synced to every PC, so anyone with access
# to that folder can still read or edit its files directly. The login controls
# what happens through the app and keeps the passwords themselves unreadable;
# it does not turn a shared folder into a locked one.
$AuthDir            = Join-Path $SystemDir 'auth'
$RecoveryPath       = Join-Path $AuthDir '_recovery.json'
$AdminFirstLoginPath = Join-Path $AuthDir 'ADMIN_FIRST_LOGIN.txt'
$SessionCookie      = 'wvn_sid'
$SessionIdleHours   = 12
$PwIterations       = 100000
$PwMinLength        = 8
$LoginMaxFails      = 5
$LoginLockMinutes   = 5
$script:Sessions    = @{}     # token -> @{ user; must_change; seen }
$script:LoginFails  = @{}     # lower-cased user name -> @{ n; until }
$script:ReqUser     = ''      # the signed-in user of the request being served
$script:RegistryCache = @{ sig = ''; list = @() }

function Get-RandomBytes { param([int]$Count)
  $b = New-Object byte[] $Count
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($b) } finally { $rng.Dispose() }
  return ,$b
}
function Get-RandomHex { param([int]$Bytes = 4)
  return ([BitConverter]::ToString((Get-RandomBytes $Bytes))).Replace('-', '').ToLowerInvariant()
}

# PBKDF2-HMAC-SHA256. The four-argument Rfc2898DeriveBytes constructor needs
# .NET Framework 4.7.2; on anything older the same function is computed by
# hand (slow, but correct) rather than silently falling back to SHA-1.
function Get-Pbkdf2 { param([string]$Password, [byte[]]$Salt, [int]$Iterations, [int]$Length = 32)
  $pw = [System.Text.Encoding]::UTF8.GetBytes($Password)
  $derived = $null
  try {
    $d = [System.Security.Cryptography.Rfc2898DeriveBytes]::new($pw, $Salt, $Iterations, [System.Security.Cryptography.HashAlgorithmName]::SHA256)
    try { $derived = $d.GetBytes($Length) } finally { $d.Dispose() }
  } catch {
    if ($Length -gt 32) { throw 'PBKDF2 fallback only produces one 32-byte block.' }
    $h = New-Object System.Security.Cryptography.HMACSHA256 (, $pw)
    try {
      $block = New-Object byte[] ($Salt.Length + 4)
      [Array]::Copy($Salt, $block, $Salt.Length)
      $block[$block.Length - 1] = 1
      $u = $h.ComputeHash($block)
      $t = [byte[]]$u.Clone()
      for ($i = 1; $i -lt $Iterations; $i++) {
        $u = $h.ComputeHash($u)
        for ($j = 0; $j -lt 32; $j++) { $t[$j] = $t[$j] -bxor $u[$j] }
      }
      $derived = New-Object byte[] $Length
      [Array]::Copy($t, $derived, $Length)
    } finally { $h.Dispose() }
  }
  return ,$derived
}
function New-PasswordHash { param([string]$Password)
  $salt = Get-RandomBytes 16
  $hash = Get-Pbkdf2 -Password $Password -Salt $salt -Iterations $PwIterations
  return ('pbkdf2-sha256$' + $PwIterations + '$' + [Convert]::ToBase64String($salt) + '$' + [Convert]::ToBase64String($hash))
}
function Test-PasswordHash { param([string]$Password, [string]$Stored)
  $p = @(([string]$Stored).Split('$'))
  if ($p.Count -ne 4 -or $p[0] -ne 'pbkdf2-sha256') { return $false }
  $iter = 0
  if (-not [int]::TryParse($p[1], [ref]$iter) -or $iter -lt 1) { return $false }
  try {
    $salt = [Convert]::FromBase64String($p[2]); $want = [Convert]::FromBase64String($p[3])
    $got = Get-Pbkdf2 -Password $Password -Salt $salt -Iterations $iter -Length $want.Length
  } catch { return $false }
  if ($got.Length -ne $want.Length) { return $false }
  # Compare every byte whatever the outcome, so the time taken says nothing
  # about how many leading bytes matched.
  $diff = 0
  for ($i = 0; $i -lt $want.Length; $i++) { $diff = $diff -bor ($got[$i] -bxor $want[$i]) }
  return ($diff -eq 0)
}
function New-TempPassword {
  # No 0/O/1/l/i: a temporary password is read off a screen and typed by hand.
  $alphabet = 'abcdefghjkmnpqrstuvwxyz23456789'
  $bytes = Get-RandomBytes 6
  $sb = New-Object System.Text.StringBuilder
  foreach ($b in $bytes) { [void]$sb.Append($alphabet[$b % $alphabet.Length]) }
  return ('Temp-' + $sb.ToString())
}

function Read-JsonFile { param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
  $text = Invoke-Locked -Path $Path -Action { param($s) Read-AllText $s }
  if (-not $text -or -not $text.Trim()) { return $null }
  return ($text | ConvertFrom-Json)
}
function Write-JsonFile { param([string]$Path, $Object)
  $dir = Split-Path -Parent $Path
  if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  $json = $Object | ConvertTo-Json -Depth 14
  Invoke-Locked -Path $Path -Action { param($s) Write-AllText $s $json }.GetNewClosure() | Out-Null
}
# @($null) is a one-element array in PowerShell, so a missing JSON array would
# otherwise turn into one empty row everywhere it is looped over.
function ConvertTo-List { param($Value)
  $out = New-Object System.Collections.Generic.List[object]
  foreach ($x in @($Value)) { if ($null -ne $x) { $out.Add($x) } }
  # Emitted one by one on purpose (no leading comma): callers pipe this, and
  # wrap it in @() wherever they index it or count it.
  return $out.ToArray()
}

function Get-AuthFile { param([string]$Username)
  $low = ([string]$Username).Trim().ToLowerInvariant()
  $slug = ($low -replace '[^a-z0-9]+', '_').Trim('_')
  if (-not $slug) { $slug = 'user' }
  $sha = [System.Security.Cryptography.SHA1]::Create()
  try { $tag = ([BitConverter]::ToString($sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($low)))).Replace('-', '').Substring(0, 6).ToLowerInvariant() }
  finally { $sha.Dispose() }
  return (Join-Path $AuthDir ('u_' + $slug + '_' + $tag + '.json'))
}
function Read-AuthRecord { param([string]$Username) return (Read-JsonFile (Get-AuthFile $Username)) }

# The roster (who exists, their role and department) stays in config.json where
# Settings has always edited it. Looked up on every request, so it is cached on
# the file's size + timestamp.
function Get-Registry {
  $sig = ''
  try { $ci = Get-Item -LiteralPath $ConfigPath; $sig = [string]$ci.Length + '|' + [string]$ci.LastWriteTimeUtc.Ticks } catch { }
  if ($sig -and $script:RegistryCache.sig -eq $sig) { return $script:RegistryCache.list }
  $list = @(ConvertTo-List (Get-Config).user_registry)
  $script:RegistryCache = @{ sig = $sig; list = $list }
  return $list
}
function Get-RegistryUser { param([string]$Username)
  $low = ([string]$Username).Trim().ToLowerInvariant()
  if (-not $low) { return $null }
  foreach ($u in (Get-Registry)) { if (([string]$u.username).Trim().ToLowerInvariant() -eq $low) { return $u } }
  return $null
}
function Test-AdminName { param([string]$Username) return (([string]$Username).Trim().ToLowerInvariant() -eq 'admin') }

# ---- optional: admin can view passwords ------------------------------------
# A hash cannot be read back, so "the admin can see everyone's password" needs
# a second, recoverable copy. It is OFF unless the admin turns it on in
# Settings. When on, each password is also stored encrypted to an RSA public
# key; the matching private key is itself encrypted with a key derived from the
# admin's password, so revealing one needs the admin password typed again and
# nothing on disk can be decrypted without it.
function Get-Recovery {
  $r = Read-JsonFile $RecoveryPath
  if ($r -and $r.enabled -and $r.public_key) { return $r }
  return $null
}
function Protect-ForAdmin { param([string]$Password, $Recovery)
  $rsa = New-Object System.Security.Cryptography.RSACryptoServiceProvider
  try {
    $rsa.PersistKeyInCsp = $false
    $rsa.FromXmlString([string]$Recovery.public_key)
    return [Convert]::ToBase64String($rsa.Encrypt([System.Text.Encoding]::UTF8.GetBytes($Password), $true))
  } finally { $rsa.Dispose() }
}
function Protect-PrivateKey { param([string]$PrivateXml, [string]$AdminPassword)
  $salt = Get-RandomBytes 16
  $aes = [System.Security.Cryptography.Aes]::Create()
  try {
    $aes.Key = Get-Pbkdf2 -Password $AdminPassword -Salt $salt -Iterations $PwIterations
    $aes.GenerateIV()
    $plain = [System.Text.Encoding]::UTF8.GetBytes($PrivateXml)
    $enc = $aes.CreateEncryptor()
    $ct = $enc.TransformFinalBlock($plain, 0, $plain.Length)
    return @{ salt = [Convert]::ToBase64String($salt); iv = [Convert]::ToBase64String($aes.IV); data = [Convert]::ToBase64String($ct) }
  } finally { $aes.Dispose() }
}
function Unprotect-PrivateKey { param($Recovery, [string]$AdminPassword)
  $aes = [System.Security.Cryptography.Aes]::Create()
  try {
    $aes.Key = Get-Pbkdf2 -Password $AdminPassword -Salt ([Convert]::FromBase64String([string]$Recovery.private_key.salt)) -Iterations $PwIterations
    $aes.IV = [Convert]::FromBase64String([string]$Recovery.private_key.iv)
    $ct = [Convert]::FromBase64String([string]$Recovery.private_key.data)
    $dec = $aes.CreateDecryptor()
    return [System.Text.Encoding]::UTF8.GetString($dec.TransformFinalBlock($ct, 0, $ct.Length))
  } finally { $aes.Dispose() }
}

function Set-UserPassword { param([string]$Username, [string]$Password, [bool]$MustChange)
  $rec = [ordered]@{
    username      = $Username
    password_hash = (New-PasswordHash $Password)
    must_change   = $MustChange
    changed_utc   = [DateTime]::UtcNow.ToString('o')
  }
  $recovery = Get-Recovery
  if ($recovery) { try { $rec.recovery = Protect-ForAdmin -Password $Password -Recovery $recovery } catch { Write-Log ('Recovery copy failed for ' + $Username + ': ' + $_.Exception.Message) 'WARN' } }
  Write-JsonFile -Path (Get-AuthFile $Username) -Object $rec
}

# Deletes the key and every viewable copy. Used when "admin can view" is
# switched off, and whenever the key could no longer be unlocked anyway (the
# admin account is being re-created) - a copy nobody can decrypt must not be
# left looking as if it were still viewable.
function Clear-RecoveryCopies {
  if (Test-Path -LiteralPath $RecoveryPath) { Remove-Item -LiteralPath $RecoveryPath -Force }
  if (-not (Test-Path -LiteralPath $AuthDir)) { return }
  foreach ($af in @(Get-ChildItem -LiteralPath $AuthDir -Filter 'u_*.json' -File -ErrorAction SilentlyContinue)) {
    try {
      $r = Read-JsonFile $af.FullName
      if ($r -and $r.PSObject.Properties.Name -contains 'recovery') { $r.PSObject.Properties.Remove('recovery'); Write-JsonFile -Path $af.FullName -Object $r }
    } catch { Write-Log ('Could not clear the viewable copy in ' + $af.Name + ': ' + $_.Exception.Message) 'WARN' }
  }
}

function Initialize-Auth {
  if (-not (Test-Path -LiteralPath $AuthDir)) { New-Item -ItemType Directory -Path $AuthDir -Force | Out-Null }
  if (Test-Path -LiteralPath (Get-AuthFile 'admin')) { return }
  # No admin account: first start after the upgrade, or the documented way out
  # of a forgotten admin password (delete system\auth\u_admin_*.json). Either
  # way the old viewable copies, if any, were locked with a password that is
  # gone.
  Clear-RecoveryCopies
  # First start after the upgrade: the admin already knows one secret, the old
  # PIN, so that becomes the first password and has to be replaced at sign-in.
  $pin = ''
  try { $pin = [string](Get-Config).admin_pin } catch { }
  if ($pin) {
    Set-UserPassword -Username 'admin' -Password $pin -MustChange $true
    Write-Log 'Auth: admin account created. First password = the old admin PIN; it must be changed at first sign-in.'
  } else {
    $tmp = New-TempPassword
    Set-UserPassword -Username 'admin' -Password $tmp -MustChange $true
    Set-Content -LiteralPath $AdminFirstLoginPath -Encoding UTF8 -Value @(
      'WVN NPI & ECN Command Center - first admin sign-in',
      '',
      ('User name : admin'),
      ('Password  : ' + $tmp),
      '',
      'You are asked to choose your own password straight away, and this file is',
      'deleted as soon as you do.'
    )
    Write-Log ('Auth: admin account created with a temporary password written to ' + $AdminFirstLoginPath)
  }
}

function New-Session { param([string]$User, [bool]$MustChange)
  $token = Get-RandomHex 32
  $script:Sessions[$token] = @{ user = $User; must_change = $MustChange; seen = [DateTime]::UtcNow; token = $token }
  return $token
}
function Remove-UserSessions { param([string]$Username, [string]$ExceptToken = '')
  $low = ([string]$Username).ToLowerInvariant()
  foreach ($k in @($script:Sessions.Keys)) {
    if ($k -ne $ExceptToken -and ([string]$script:Sessions[$k].user).ToLowerInvariant() -eq $low) { $script:Sessions.Remove($k) }
  }
}
function Get-RequestSession { param([System.Net.HttpListenerRequest]$Request)
  $token = ''
  try { $c = $Request.Cookies[$SessionCookie]; if ($c) { $token = [string]$c.Value } } catch { }
  if (-not $token) { return $null }
  $s = $script:Sessions[$token]
  if (-not $s) { return $null }
  if (([DateTime]::UtcNow - $s.seen).TotalHours -gt $SessionIdleHours) { $script:Sessions.Remove($token); return $null }
  # A user the admin removed from the roster on another PC loses access here
  # too, as soon as the synced config.json arrives.
  if (-not (Get-RegistryUser $s.user)) { $script:Sessions.Remove($token); return $null }
  $s.seen = [DateTime]::UtcNow
  return $s
}
function Set-SessionCookie { param([System.Net.HttpListenerResponse]$Response, [string]$Token)
  if ($Token) { $Response.AppendHeader('Set-Cookie', ($SessionCookie + '=' + $Token + '; Path=/; HttpOnly; SameSite=Strict')) }
  else { $Response.AppendHeader('Set-Cookie', ($SessionCookie + '=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0')) }
}
function New-RedirectResponse { param([System.Net.HttpListenerResponse]$Response, [string]$Location)
  $Response.StatusCode = 302
  $Response.RedirectLocation = $Location
  $Response.Headers.Add('Cache-Control', 'no-store')
  $Response.ContentLength64 = 0
  $Response.OutputStream.Close()
}
# HttpListener decodes QueryString with the request's ContentEncoding, which a
# plain GET does not have - so a Vietnamese folder name arrives as mojibake.
# This reads the raw query and decodes it as UTF-8, which is what browsers send.
function Get-QueryValue { param([System.Net.HttpListenerRequest]$Request, [string]$Name)
  $q = [string]$Request.Url.Query
  if ($q.StartsWith('?')) { $q = $q.Substring(1) }
  foreach ($pair in $q.Split('&')) {
    if (-not $pair) { continue }
    $kv = $pair.Split('=', 2)
    if ([System.Uri]::UnescapeDataString($kv[0].Replace('+', ' ')) -ne $Name) { continue }
    if ($kv.Count -lt 2) { return '' }
    return [System.Uri]::UnescapeDataString($kv[1].Replace('+', ' '))
  }
  return ''
}
function Get-SessionInfo { param($Session)
  if (-not $Session) { return @{ authenticated = $false } }
  $ru = Get-RegistryUser $Session.user
  return @{
    authenticated = $true
    user          = [string]$ru.username
    role          = if (Test-AdminName $ru.username) { 'admin' } else { [string]$ru.role }
    department    = [string]$ru.department
    must_change   = [bool]$Session.must_change
    is_admin      = (Test-AdminName $ru.username)
  }
}
function Test-NewPassword { param([string]$Password)
  if ($Password.Length -lt $PwMinLength) { return ('Use at least ' + $PwMinLength + ' characters.') }
  if ($Password.Length -gt 128) { return 'Use at most 128 characters.' }
  return ''
}

function Invoke-AuthApi {
  param([System.Net.HttpListenerRequest]$Req, [System.Net.HttpListenerResponse]$Res, [string]$Path, [string]$Method, $Session)
  $json = { param($code, $body) New-JsonResponse -Response $Res -StatusCode $code -Body $body }

  if ($Method -eq 'GET' -and $Path -eq '/api/auth/status') {
    $info = Get-SessionInfo $Session
    $cfg = Get-Config
    $info.app = @{ name = [string]$cfg.system_info.app_name; version = [string]$cfg.system_info.version }
    & $json 200 $info
    return
  }
  if ($Method -eq 'POST' -and $Path -eq '/api/auth/login') {
    $body = Read-JsonBody -Request $Req
    $name = ([string]$body.username).Trim()
    $pw = [string]$body.password
    $low = $name.ToLowerInvariant()
    $f = $script:LoginFails[$low]
    if ($f -and $f.until -and $f.until -gt [DateTime]::UtcNow) {
      $mins = [Math]::Ceiling(($f.until - [DateTime]::UtcNow).TotalMinutes)
      & $json 429 @{ error = ('Too many wrong tries. This account is locked for ' + $mins + ' more minute(s).'); locked = $true }
      return
    }
    $ru = Get-RegistryUser $name
    $rec = if ($ru) { Read-AuthRecord $ru.username } else { $null }
    if ($ru -and -not $rec) {
      & $json 403 @{ error = 'No password has been issued for this account yet. Ask the admin for a temporary password.'; no_password = $true }
      return
    }
    if (-not $ru -or -not $pw -or -not (Test-PasswordHash -Password $pw -Stored ([string]$rec.password_hash))) {
      if ($low) {
        if (-not $f -or ($f.until -and $f.until -le [DateTime]::UtcNow)) { $f = @{ n = 0; until = $null } }
        $f.n++
        if ($f.n -ge $LoginMaxFails) { $f.until = [DateTime]::UtcNow.AddMinutes($LoginLockMinutes); $f.n = 0; Write-Log ('Auth: ' + $name + ' locked after ' + $LoginMaxFails + ' wrong passwords.') 'WARN' }
        $script:LoginFails[$low] = $f
      }
      $left = if ($f -and -not $f.until) { $LoginMaxFails - $f.n } else { 0 }
      $msg = 'Wrong user name or password.'
      if ($f -and $f.until) { $msg = 'Too many wrong tries. This account is locked for ' + $LoginLockMinutes + ' minutes.' }
      & $json 401 @{ error = $msg; tries_left = $left; locked = [bool]($f -and $f.until) }
      return
    }
    $script:LoginFails.Remove($low)
    $must = [bool]$rec.must_change
    # "Admin can view" was switched on after this password was set: this is
    # the one moment the server sees it, so the recoverable copy is taken now.
    if (-not $rec.recovery) {
      $recovery = Get-Recovery
      if ($recovery) {
        try {
          $rec | Add-Member -NotePropertyName recovery -NotePropertyValue (Protect-ForAdmin -Password $pw -Recovery $recovery) -Force
          Write-JsonFile -Path (Get-AuthFile $ru.username) -Object $rec
        } catch { Write-Log ('Recovery copy failed for ' + $ru.username + ': ' + $_.Exception.Message) 'WARN' }
      }
    }
    $token = New-Session -User ([string]$ru.username) -MustChange $must
    Set-SessionCookie -Response $Res -Token $token
    try { Add-Audit -User ([string]$ru.username) -Action 'Auth_Login' -ProjectId '' -ObjType 'Session' -ObjId $WriterId -From '' -To '' -Detail '' } catch { }
    & $json 200 (Get-SessionInfo $script:Sessions[$token])
    return
  }
  if ($Method -eq 'POST' -and $Path -eq '/api/auth/logout') {
    if ($Session) { $script:Sessions.Remove([string]$Session.token) }
    Set-SessionCookie -Response $Res -Token ''
    & $json 200 @{ ok = $true }
    return
  }

  # Everything below needs a signed-in user.
  if (-not $Session) { & $json 401 @{ error = 'Sign in first.'; auth = 'required' }; return }
  $me = [string]$Session.user
  $iAmAdmin = Test-AdminName $me

  if ($Method -eq 'POST' -and $Path -eq '/api/auth/change-password') {
    $body = Read-JsonBody -Request $Req
    $cur = [string]$body.current; $new = [string]$body.new
    $rec = Read-AuthRecord $me
    if (-not $rec -or -not (Test-PasswordHash -Password $cur -Stored ([string]$rec.password_hash))) { & $json 403 @{ error = 'The current password is wrong.' }; return }
    $bad = Test-NewPassword $new
    if ($bad) { & $json 400 @{ error = $bad }; return }
    if ($new -ceq $cur) { & $json 400 @{ error = 'The new password must be different from the current one.' }; return }
    if ($iAmAdmin) {
      # The recovery private key is wrapped with the admin password, so it has
      # to be re-wrapped before the old password stops working.
      $recovery = Get-Recovery
      if ($recovery) {
        $priv = Unprotect-PrivateKey -Recovery $recovery -AdminPassword $cur
        $recovery.private_key = Protect-PrivateKey -PrivateXml $priv -AdminPassword $new
        Write-JsonFile -Path $RecoveryPath -Object $recovery
      }
    }
    Set-UserPassword -Username $me -Password $new -MustChange $false
    $Session.must_change = $false
    Remove-UserSessions -Username $me -ExceptToken ([string]$Session.token)
    if ($iAmAdmin) {
      # The old plain-text PIN has now been replaced for good.
      try {
        $cfg = Get-Config
        if ($cfg.PSObject.Properties.Name -contains 'admin_pin') { $cfg.PSObject.Properties.Remove('admin_pin'); Save-Config $cfg }
      } catch { Write-Log ('Could not remove admin_pin from config.json: ' + $_.Exception.Message) 'WARN' }
      if (Test-Path -LiteralPath $AdminFirstLoginPath) { Remove-Item -LiteralPath $AdminFirstLoginPath -Force -ErrorAction SilentlyContinue }
    }
    try { Add-Audit -User $me -Action 'Auth_Password_Change' -ProjectId '' -ObjType 'User' -ObjId $me -From '(hidden)' -To '(hidden)' -Detail '' } catch { }
    & $json 200 @{ ok = $true }
    return
  }

  # Admin-only from here.
  if (-not $iAmAdmin) { & $json 403 @{ error = 'Only the admin user can manage accounts.' }; return }
  if ($Session.must_change) { & $json 403 @{ error = 'Choose your own password first.' }; return }

  if ($Method -eq 'GET' -and $Path -eq '/api/auth/users') {
    $recovery = Get-Recovery
    $rows = New-Object System.Collections.Generic.List[object]
    foreach ($u in (Get-Registry)) {
      $r = Read-AuthRecord $u.username
      $stored = ''
      if ($r) { $hp = @(([string]$r.password_hash).Split('$')); if ($hp.Count -eq 4) { $stored = $hp[0] + '$' + $hp[1] + '$' + $hp[2].Substring(0, [Math]::Min(4, $hp[2].Length)) + '...$' + $hp[3].Substring(0, [Math]::Min(6, $hp[3].Length)) + '...' } }
      $rows.Add(@{
        username = [string]$u.username; role = [string]$u.role; department = [string]$u.department
        has_password = [bool]$r; must_change = [bool]($r -and $r.must_change)
        changed_utc = if ($r) { [string]$r.changed_utc } else { '' }
        stored = $stored
        recoverable = [bool]($recovery -and $r -and $r.recovery)
      })
    }
    & $json 200 @{ users = $rows.ToArray(); admin_can_view = [bool]$recovery; min_length = $PwMinLength }
    return
  }
  if ($Method -eq 'POST' -and $Path -eq '/api/auth/reset-password') {
    $body = Read-JsonBody -Request $Req
    $ru = Get-RegistryUser ([string]$body.username)
    if (-not $ru) { & $json 404 @{ error = 'That user is not in the registry.' }; return }
    if (Test-AdminName $ru.username) { & $json 400 @{ error = 'The admin password is changed from "Change my password", not reset.' }; return }
    $tmp = New-TempPassword
    $had = [bool](Read-AuthRecord $ru.username)
    Set-UserPassword -Username ([string]$ru.username) -Password $tmp -MustChange $true
    Remove-UserSessions -Username ([string]$ru.username)
    $script:LoginFails.Remove(([string]$ru.username).ToLowerInvariant())
    Add-Audit -User $me -Action $(if ($had) { 'Auth_Password_Reset' } else { 'Auth_Password_Issue' }) -ProjectId '' -ObjType 'User' -ObjId ([string]$ru.username) -From '' -To 'Temporary password' -Detail ''
    & $json 200 @{ ok = $true; username = [string]$ru.username; temp_password = $tmp }
    return
  }
  if ($Method -eq 'POST' -and $Path -eq '/api/auth/recovery') {
    # Switches "admin can view passwords" on or off. Either way the admin
    # password is asked for again.
    $body = Read-JsonBody -Request $Req
    $adminPw = [string]$body.admin_password
    $rec = Read-AuthRecord $me
    if (-not $rec -or -not (Test-PasswordHash -Password $adminPw -Stored ([string]$rec.password_hash))) { & $json 403 @{ error = 'Wrong admin password.' }; return }
    if ($body.enable) {
      if (-not (Get-Recovery)) {
        Clear-RecoveryCopies
        $rec = Read-AuthRecord $me
        $rsa = New-Object System.Security.Cryptography.RSACryptoServiceProvider 2048
        try {
          $rsa.PersistKeyInCsp = $false
          $obj = [ordered]@{
            enabled = $true; enabled_utc = [DateTime]::UtcNow.ToString('o'); enabled_by = $me
            public_key = $rsa.ToXmlString($false)
            private_key = (Protect-PrivateKey -PrivateXml ($rsa.ToXmlString($true)) -AdminPassword $adminPw)
          }
        } finally { $rsa.Dispose() }
        Write-JsonFile -Path $RecoveryPath -Object $obj
        # The admin's own copy can be taken straight away.
        try { $rec | Add-Member -NotePropertyName recovery -NotePropertyValue (Protect-ForAdmin -Password $adminPw -Recovery (Get-Recovery)) -Force; Write-JsonFile -Path (Get-AuthFile $me) -Object $rec } catch { }
        Add-Audit -User $me -Action 'Auth_AdminView_On' -ProjectId '' -ObjType 'Config' -ObjId 'auth' -From 'hash only' -To 'admin can view passwords' -Detail ''
      }
    } else {
      Clear-RecoveryCopies
      Add-Audit -User $me -Action 'Auth_AdminView_Off' -ProjectId '' -ObjType 'Config' -ObjId 'auth' -From 'admin can view passwords' -To 'hash only' -Detail 'Recoverable copies deleted'
    }
    & $json 200 @{ ok = $true; admin_can_view = [bool](Get-Recovery) }
    return
  }
  if ($Method -eq 'POST' -and $Path -eq '/api/auth/reveal') {
    $body = Read-JsonBody -Request $Req
    $adminPw = [string]$body.admin_password
    $mine = Read-AuthRecord $me
    if (-not $mine -or -not (Test-PasswordHash -Password $adminPw -Stored ([string]$mine.password_hash))) { & $json 403 @{ error = 'Wrong admin password.' }; return }
    $recovery = Get-Recovery
    if (-not $recovery) { & $json 400 @{ error = 'Viewing passwords is switched off.' }; return }
    $ru = Get-RegistryUser ([string]$body.username)
    $r = if ($ru) { Read-AuthRecord $ru.username } else { $null }
    if (-not $r -or -not $r.recovery) { & $json 404 @{ error = 'No viewable copy exists for this user yet. One is saved the next time they sign in or change their password.' }; return }
    $rsa = New-Object System.Security.Cryptography.RSACryptoServiceProvider
    try {
      $rsa.PersistKeyInCsp = $false
      $rsa.FromXmlString((Unprotect-PrivateKey -Recovery $recovery -AdminPassword $adminPw))
      $plain = [System.Text.Encoding]::UTF8.GetString($rsa.Decrypt([Convert]::FromBase64String([string]$r.recovery), $true))
    } finally { $rsa.Dispose() }
    Add-Audit -User $me -Action 'Auth_Password_Reveal' -ProjectId '' -ObjType 'User' -ObjId ([string]$ru.username) -From '' -To '' -Detail 'Password viewed by admin'
    & $json 200 @{ username = [string]$ru.username; password = $plain }
    return
  }
  & $json 404 @{ error = 'not found' }
}

# ---- common vault folder structure (v12) -----------------------------------
# Save-Evidence used to hard-code [Model]\[DocType]\[PartID]. The admin now sets
# the levels in Settings; that default is what an install with no setting gets,
# so nothing moves on upgrade. A level may mix tokens and plain text.
$EvidenceLevelTokens = @('Model', 'Process', 'ProjectID', 'Step', 'DocType', 'PartID')
function Get-EvidenceLevels { param($Config)
  $lv = @(ConvertTo-List $Config.deployment_defaults.evidence_folder_levels | ForEach-Object { ([string]$_).Trim() } | Where-Object { $_ })
  if (-not $lv.Count) { return @('[Model]', '[DocType]', '[PartID]') }
  return $lv
}
function Test-EvidenceLevels { param($Levels)
  $errs = @()
  $lv = @(ConvertTo-List $Levels | ForEach-Object { ([string]$_).Trim() })
  if (-not $lv.Count) { return @('At least one folder level is required.') }
  if ($lv.Count -gt 8) { $errs += 'Use at most 8 folder levels.' }
  $anyToken = $false
  for ($i = 0; $i -lt $lv.Count; $i++) {
    $l = $lv[$i]
    if (-not $l) { $errs += ('Level ' + ($i + 1) + ' is empty.'); continue }
    if ($l -match '[\\/:\*\?"<>\|]') { $errs += ('Level ' + ($i + 1) + ' contains a character Windows does not allow in a folder name.') }
    if ($i -eq 0 -and $l.ToLowerInvariant() -eq '_vault') { $errs += 'The first level cannot be "_vault": that folder holds the vault''s project data.' }
    foreach ($m in [regex]::Matches($l, '\[([^\]]*)\]')) {
      $anyToken = $true
      if ($EvidenceLevelTokens -notcontains $m.Groups[1].Value) { $errs += ('Level ' + ($i + 1) + ': [' + $m.Groups[1].Value + '] is not a known token. Use ' + (($EvidenceLevelTokens | ForEach-Object { '[' + $_ + ']' }) -join ', ') + '.') }
    }
  }
  if (-not $anyToken) { $errs += 'Use at least one token such as [Model] or [DocType], or every file lands in the same folder.' }
  return $errs
}
function Resolve-EvidenceLevels { param($Config, [hashtable]$Values)
  $out = New-Object System.Collections.Generic.List[string]
  foreach ($l in (Get-EvidenceLevels $Config)) {
    $s = [regex]::Replace($l, '\[([^\]]*)\]', { param($m) [string]$Values[$m.Groups[1].Value] })
    $s = (Get-SafeName $s).Trim(' ', '.', '_', '-')
    if ($s) { $out.Add($s) }
  }
  return $out.ToArray()
}

# ===================================================== v12 personal vaults ==
# A personal vault is a user's own small register: their own project fields,
# their own processes / steps / deadlines, their own document types and folder
# levels. It is deliberately separate from the NPI/ECN stores - nothing here
# reads or writes system\tracking - and lives beside the common vault, inside
# the synced site folder:
#   <site>\Personal_Vaults\<owner>\<vault name>\_vault\vault.json     setup
#                                              \_vault\projects.json  register
#                                              \<folder levels>\...   documents
# Visible to its owner and to the admin only.
$PersonalRoot = Join-Path ([System.IO.Path]::GetFullPath((Split-Path -Parent $RootDir))) 'Personal_Vaults'

function Get-PersonalVaults {
  $out = New-Object System.Collections.Generic.List[object]
  if (-not (Test-Path -LiteralPath $PersonalRoot)) { return }
  foreach ($ownerDir in @(Get-ChildItem -LiteralPath $PersonalRoot -Directory -ErrorAction SilentlyContinue)) {
    foreach ($vDir in @(Get-ChildItem -LiteralPath $ownerDir.FullName -Directory -ErrorAction SilentlyContinue)) {
      $metaPath = Join-Path $vDir.FullName '_vault\vault.json'
      if (-not (Test-Path -LiteralPath $metaPath -PathType Leaf)) { continue }
      try {
        $meta = Read-JsonFile $metaPath
        if ($meta -and $meta.id) { $out.Add(@{ meta = $meta; dir = $vDir.FullName }) }
      } catch { Write-Log ('Personal vault unreadable: ' + $metaPath + ' - ' + $_.Exception.Message) 'WARN' }
    }
  }
  return $out.ToArray()
}
function Find-PersonalVault { param([string]$Id)
  foreach ($v in (Get-PersonalVaults)) { if ([string]$v.meta.id -eq $Id) { return $v } }
  return $null
}
function Test-VaultAccess { param($Vault, [string]$User)
  if (Test-AdminName $User) { return $true }
  return (([string]$Vault.meta.owner).ToLowerInvariant() -eq $User.ToLowerInvariant())
}
function Read-VaultProjects { param($Vault)
  $d = Read-JsonFile (Join-Path $Vault.dir '_vault\projects.json')
  if (-not $d) { return }
  return (ConvertTo-List $d.projects)
}
function Write-VaultProjects { param($Vault, $Projects)
  Write-JsonFile -Path (Join-Path $Vault.dir '_vault\projects.json') -Object ([ordered]@{ projects = @($Projects) })
}
function Add-VaultLog { param($Vault, [string]$User, [string]$Action, [string]$Detail)
  try {
    $line = ([ordered]@{ utc = [DateTime]::UtcNow.ToString('o'); user = $User; action = $Action; detail = $Detail } | ConvertTo-Json -Compress)
    Add-Content -LiteralPath (Join-Path $Vault.dir ('_vault\activity_' + $WriterId + '.log')) -Value $line -Encoding UTF8
  } catch { }
}
function ConvertTo-VaultFolderName { param([string]$Name)
  $n = (Get-SafeName ([string]$Name)).Trim(' ', '.')
  if ($n.Length -gt 60) { $n = $n.Substring(0, 60).Trim() }
  return $n
}

# Cleans and validates a setup sent by the browser (typed in the GUI or parsed
# from the Excel template). Returns @{ errors; config }.
function ConvertTo-VaultConfig { param($In)
  $errs = New-Object System.Collections.Generic.List[string]
  $noBrackets = { param($s) (([string]$s) -replace '[\[\]]', '').Trim() }

  $fields = New-Object System.Collections.Generic.List[object]
  $labels = @{}; $keys = @{}
  foreach ($f in (ConvertTo-List $In.fields)) {
    $label = & $noBrackets $f.label
    if (-not $label) { $errs.Add('Every project field needs a label.'); continue }
    $ll = $label.ToLowerInvariant()
    if ($labels.ContainsKey($ll)) { $errs.Add("Field '" + $label + "' appears twice."); continue }
    if (@('project id', 'process', 'step', 'doctype') -contains $ll) { $errs.Add("'" + $label + "' is a built-in name. Give the field another label."); continue }
    $labels[$ll] = $true
    $type = ([string]$f.type).ToLowerInvariant()
    if (@('text', 'number', 'date', 'list', 'yesno') -notcontains $type) { $type = 'text' }
    $key = [string]$f.key
    if ($key -notmatch '^f_[a-z0-9_]{1,24}$' -or $keys.ContainsKey($key)) { $key = 'f_' + (Get-RandomHex 4) }
    $keys[$key] = $true
    $opts = @(ConvertTo-List $f.options | ForEach-Object { ([string]$_).Trim() } | Where-Object { $_ })
    if ($type -eq 'list' -and -not $opts.Count) { $errs.Add("List field '" + $label + "' needs at least one choice.") }
    $fields.Add([ordered]@{ key = $key; label = $label; type = $type; options = $opts; required = [bool]$f.required; inList = [bool]$f.inList })
  }
  if (-not $fields.Count) { $errs.Add('At least one project field is required.') }

  $doctypes = New-Object System.Collections.Generic.List[object]
  $codes = @{}
  foreach ($d in (ConvertTo-List $In.doctypes)) {
    $code = (([string]$d.code).Trim().ToUpperInvariant() -replace '\s+', '-')
    if (-not $code) { continue }
    if ($code -notmatch '^[A-Z0-9][A-Z0-9_\-]{0,23}$') { $errs.Add("Document code '" + $code + "' may only use letters, digits, - and _ (24 at most)."); continue }
    if ($codes.ContainsKey($code)) { $errs.Add("Document code '" + $code + "' appears twice."); continue }
    $codes[$code] = $true
    $doctypes.Add([ordered]@{ code = $code; name = ([string]$d.name).Trim(); hint = ([string]$d.hint).Trim() })
  }

  $processes = New-Object System.Collections.Generic.List[object]
  $pnames = @{}; $pids = @{}
  foreach ($p in (ConvertTo-List $In.processes)) {
    $pname = & $noBrackets $p.name
    if (-not $pname) { $errs.Add('Every process needs a name.'); continue }
    if ($pnames.ContainsKey($pname.ToLowerInvariant())) { $errs.Add("Process '" + $pname + "' appears twice."); continue }
    $pnames[$pname.ToLowerInvariant()] = $true
    $pid2 = [string]$p.id
    if ($pid2 -notmatch '^p_[a-z0-9_]{1,24}$' -or $pids.ContainsKey($pid2)) { $pid2 = 'p_' + (Get-RandomHex 4) }
    $pids[$pid2] = $true
    $steps = New-Object System.Collections.Generic.List[object]
    foreach ($s in (ConvertTo-List $p.steps)) {
      $sname = & $noBrackets $s.name
      if (-not $sname) { $errs.Add("Process '" + $pname + "': every step needs a name."); continue }
      $days = 0
      [void][int]::TryParse(([string]$s.days), [ref]$days)
      if ($days -lt 0) { $days = 0 }
      if ($days -gt 3650) { $days = 3650 }
      $docs = New-Object System.Collections.Generic.List[string]
      foreach ($c in (ConvertTo-List $s.docs)) {
        $cc = ([string]$c).Trim().ToUpperInvariant()
        if (-not $cc -or $docs.Contains($cc)) { continue }
        if (-not $codes.ContainsKey($cc)) { $errs.Add("Process '" + $pname + "', step '" + $sname + "': document type '" + $cc + "' is not defined."); continue }
        $docs.Add($cc)
      }
      $steps.Add([ordered]@{ name = $sname; days = $days; docs = @($docs.ToArray()) })
    }
    if (-not $steps.Count) { $errs.Add("Process '" + $pname + "' needs at least one step.") }
    $processes.Add([ordered]@{ id = $pid2; name = $pname; desc = ([string]$p.desc).Trim(); steps = @($steps.ToArray()) })
  }
  if (-not $processes.Count) { $errs.Add('At least one process is required.') }

  $folder = New-Object System.Collections.Generic.List[string]
  $known = @{ 'project id' = 1; 'process' = 1; 'step' = 1; 'doctype' = 1 }
  foreach ($k in $labels.Keys) { $known[$k] = 1 }
  foreach ($l in (ConvertTo-List $In.folder)) {
    $lv = ([string]$l).Trim()
    if (-not $lv) { continue }
    if ($lv -match '[\\/:\*\?"<>\|]') { $errs.Add("Folder level '" + $lv + "' contains a character Windows does not allow in a folder name."); continue }
    foreach ($m in [regex]::Matches($lv, '\[([^\]]*)\]')) {
      if (-not $known.ContainsKey($m.Groups[1].Value.Trim().ToLowerInvariant())) { $errs.Add("Folder level '" + $lv + "': [" + $m.Groups[1].Value + '] is not a field of this vault.') }
    }
    $folder.Add($lv)
  }
  if (-not $folder.Count) { $folder.Add('[Project ID]') }
  if ($folder.Count -gt 8) { $errs.Add('Use at most 8 folder levels.') }

  return @{
    errors = @($errs.ToArray())
    config = [ordered]@{ fields = @($fields.ToArray()); processes = @($processes.ToArray()); doctypes = @($doctypes.ToArray()); folder = @($folder.ToArray()) }
  }
}
function Resolve-VaultFolder { param($Meta, $Project, [string]$ProcessName, [string]$StepName, [string]$Code)
  $map = @{ 'project id' = [string]$Project.id; 'process' = $ProcessName; 'step' = $StepName; 'doctype' = $Code }
  foreach ($f in (ConvertTo-List $Meta.fields)) { $map[([string]$f.label).ToLowerInvariant()] = [string]$Project.values.([string]$f.key) }
  $out = New-Object System.Collections.Generic.List[string]
  foreach ($l in (ConvertTo-List $Meta.folder)) {
    $s = [regex]::Replace([string]$l, '\[([^\]]*)\]', { param($m) [string]$map[$m.Groups[1].Value.Trim().ToLowerInvariant()] })
    $s = ConvertTo-VaultFolderName $s
    if ($s) { $out.Add($s) }
  }
  return ($out.ToArray() -join '\')
}
function Test-IsoDate { param([string]$Value)
  if ($Value -notmatch '^\d{4}-\d{2}-\d{2}$') { return $false }
  $d = [datetime]::MinValue
  return [datetime]::TryParseExact($Value, 'yyyy-MM-dd', [cultureinfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::None, [ref]$d)
}
function Get-VaultSummary { param($Vault, [string]$User)
  $m = $Vault.meta
  return @{
    id = [string]$m.id; kind = 'personal'; name = [string]$m.name; owner = [string]$m.owner
    archived = [bool]$m.archived; path = [string]$Vault.dir
    projects = @(Read-VaultProjects $Vault).Count
    mine = (([string]$m.owner).ToLowerInvariant() -eq $User.ToLowerInvariant())
    created_utc = [string]$m.created_utc
  }
}

function Invoke-VaultApi {
  param([System.Net.HttpListenerRequest]$Req, [System.Net.HttpListenerResponse]$Res, [string]$Path, [string]$Method, [string]$User)
  $json = { param($code, $body) New-JsonResponse -Response $Res -StatusCode $code -Body $body }
  $isAdmin = Test-AdminName $User

  if ($Path -eq '/api/vaults' -and $Method -eq 'GET') {
    $list = New-Object System.Collections.Generic.List[object]
    $list.Add(@{
      id = 'common'; kind = 'common'; name = (Split-Path -Leaf $EvidenceDir); owner = ''; archived = $false
      path = $EvidenceDir; projects = @(Read-Store 'lb_projects').Count; mine = $false
    })
    foreach ($v in (Get-PersonalVaults)) {
      if (-not (Test-VaultAccess -Vault $v -User $User)) { continue }
      $list.Add((Get-VaultSummary -Vault $v -User $User))
    }
    & $json 200 @{ vaults = $list.ToArray(); personal_root = $PersonalRoot; user = $User; is_admin = $isAdmin }
    return
  }
  if ($Path -eq '/api/vaults' -and $Method -eq 'POST') {
    $body = Read-JsonBody -Request $Req
    $name = ConvertTo-VaultFolderName ([string]$body.name)
    if (-not $name) { & $json 400 @{ error = 'Give the vault a name.' }; return }
    $ownerDir = Join-Path $PersonalRoot (ConvertTo-VaultFolderName $User)
    $dir = Join-Path $ownerDir $name
    if (Test-Path -LiteralPath $dir) { & $json 409 @{ error = 'You already have a vault with this name.' }; return }
    $cv = ConvertTo-VaultConfig $body.config
    if ($cv.errors.Count) { & $json 400 @{ error = ($cv.errors -join ' '); errors = $cv.errors }; return }
    $meta = [ordered]@{
      id = 'v_' + (Get-RandomHex 5); name = $name; owner = $User; archived = $false
      created_utc = [DateTime]::UtcNow.ToString('o'); seq = 0
      fields = $cv.config.fields; processes = $cv.config.processes; doctypes = $cv.config.doctypes; folder = $cv.config.folder
    }
    New-Item -ItemType Directory -Path (Join-Path $dir '_vault') -Force | Out-Null
    Write-JsonFile -Path (Join-Path $dir '_vault\vault.json') -Object $meta
    $v = @{ meta = (Read-JsonFile (Join-Path $dir '_vault\vault.json')); dir = $dir }
    Write-VaultProjects -Vault $v -Projects @()
    Add-VaultLog -Vault $v -User $User -Action 'Vault_Create' -Detail $name
    Write-Log ('Personal vault created: ' + $dir + ' by ' + $User)
    & $json 200 @{ ok = $true; vault = (Get-VaultSummary -Vault $v -User $User) }
    return
  }
  if ($Path -notmatch '^/api/vaults/(v_[a-z0-9]{4,24})(?:/([a-z\-]+))?$') { & $json 404 @{ error = 'not found' }; return }
  $vid = $Matches[1]; $verb = [string]$Matches[2]
  $v = Find-PersonalVault $vid
  # Same answer for "does not exist" and "not yours", so a vault id cannot be
  # used to find out what other people have.
  if (-not $v -or -not (Test-VaultAccess -Vault $v -User $User)) { & $json 404 @{ error = 'That vault does not exist, or it is not yours.' }; return }
  $meta = $v.meta
  $metaPath = Join-Path $v.dir '_vault\vault.json'

  if ($Method -eq 'GET' -and -not $verb) {
    & $json 200 @{ vault = $meta; projects = @(Read-VaultProjects $v); path = [string]$v.dir; summary = (Get-VaultSummary -Vault $v -User $User) }
    return
  }
  if ($Method -eq 'GET' -and $verb -eq 'file') {
    $rel = (Get-QueryValue -Request $Req -Name 'path') -replace '/', '\'
    $full = ''
    try { $full = [System.IO.Path]::GetFullPath((Join-Path $v.dir $rel)) } catch { }
    $root = [System.IO.Path]::GetFullPath($v.dir).TrimEnd('\') + '\'
    if (-not $rel -or -not $full.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) -or $full.StartsWith($root + '_vault\', [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $full -PathType Leaf)) {
      & $json 404 @{ error = 'file not found' }; return
    }
    # Same fixed allowlist as /api/vault/view: an uploaded file is never
    # served back as markup.
    $type = switch ([System.IO.Path]::GetExtension($full).ToLowerInvariant()) {
      '.png' { 'image/png' } '.jpg' { 'image/jpeg' } '.jpeg' { 'image/jpeg' } '.webp' { 'image/webp' } '.gif' { 'image/gif' }
      '.pdf' { 'application/pdf' } '.txt' { 'text/plain; charset=utf-8' } '.csv' { 'text/plain; charset=utf-8' }
      default { 'application/octet-stream' }
    }
    $bytes = [System.IO.File]::ReadAllBytes($full)
    $Res.StatusCode = 200
    $Res.ContentType = $type
    $disp = if ($type -eq 'application/octet-stream') { 'attachment' } else { 'inline' }
    $Res.AddHeader('Content-Disposition', $disp + "; filename*=UTF-8''" + ([System.Uri]::EscapeDataString([System.IO.Path]::GetFileName($full))))
    $Res.Headers.Add('Cache-Control', 'no-store')
    $Res.ContentLength64 = $bytes.Length
    $Res.OutputStream.Write($bytes, 0, $bytes.Length)
    $Res.OutputStream.Close()
    return
  }
  if ($Method -ne 'POST') { & $json 404 @{ error = 'not found' }; return }
  $body = Read-JsonBody -Request $Req

  if ($verb -eq 'config') {
    $cv = ConvertTo-VaultConfig $body
    if ($cv.errors.Count) { & $json 400 @{ error = ($cv.errors -join ' '); errors = $cv.errors }; return }
    # A process that still has projects cannot disappear from under them.
    $keptIds = @{}; foreach ($p in $cv.config.processes) { $keptIds[[string]$p.id] = $true }
    $stranded = @(Read-VaultProjects $v | Where-Object { -not $keptIds.ContainsKey([string]$_.process_id) } | ForEach-Object { [string]$_.id })
    if ($stranded.Count) { & $json 400 @{ error = ('A process that still has projects was removed (' + ($stranded -join ', ') + '). Keep the process, or delete those projects first.') }; return }
    foreach ($k in @('fields', 'processes', 'doctypes', 'folder')) { $meta | Add-Member -NotePropertyName $k -NotePropertyValue $cv.config[$k] -Force }
    Write-JsonFile -Path $metaPath -Object $meta
    Add-VaultLog -Vault $v -User $User -Action 'Setup_Save' -Detail ''
    & $json 200 @{ ok = $true; vault = (Read-JsonFile $metaPath) }
    return
  }
  if ($verb -eq 'archive') {
    $meta | Add-Member -NotePropertyName archived -NotePropertyValue ([bool]$body.archived) -Force
    Write-JsonFile -Path $metaPath -Object $meta
    Add-VaultLog -Vault $v -User $User -Action $(if ($body.archived) { 'Vault_Archive' } else { 'Vault_Restore' }) -Detail ''
    & $json 200 @{ ok = $true; archived = [bool]$body.archived }
    return
  }
  if ($verb -eq 'open') {
    if (-not (Test-LoopbackRequest -Request $Req)) { & $json 403 @{ error = 'This action may only be requested from this machine.' }; return }
    $rel = ([string]$body.path) -replace '/', '\'
    $target = $v.dir
    if ($rel) {
      try { $cand = [System.IO.Path]::GetFullPath((Join-Path $v.dir $rel)) } catch { $cand = '' }
      # The trailing backslash matters: without it a sibling folder whose name
      # merely starts with this vault's name would pass the check.
      $vRoot = [System.IO.Path]::GetFullPath($v.dir).TrimEnd('\') + '\'
      if ($cand -and $cand.StartsWith($vRoot, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $cand)) { $target = $cand }
    }
    if (Test-Path -LiteralPath $target -PathType Leaf) { Start-Process explorer.exe -ArgumentList "/select,`"$target`"" }
    else { Start-Process explorer.exe -ArgumentList "`"$target`"" }
    & $json 200 @{ ok = $true }
    return
  }

  $projects = New-Object System.Collections.Generic.List[object]
  foreach ($p in (Read-VaultProjects $v)) { $projects.Add($p) }
  $fieldDefs = @(ConvertTo-List $meta.fields)

  if ($verb -eq 'projects') {
    $proc = $null
    foreach ($p in (ConvertTo-List $meta.processes)) { if ([string]$p.id -eq [string]$body.process_id) { $proc = $p } }
    if (-not $proc) { & $json 400 @{ error = 'Choose a process.' }; return }
    $start = [string]$body.start
    if (-not (Test-IsoDate $start)) { & $json 400 @{ error = 'Give a start date.' }; return }
    $values = [ordered]@{}
    $missing = @()
    foreach ($f in $fieldDefs) {
      $val = ([string]$body.values.([string]$f.key)).Trim()
      if ($f.required -and -not $val) { $missing += [string]$f.label }
      if ($val -and $f.type -eq 'date' -and -not (Test-IsoDate $val)) { & $json 400 @{ error = ("'" + [string]$f.label + "' must be a date.") }; return }
      if ($val -and $f.type -eq 'list' -and (@(ConvertTo-List $f.options) -notcontains $val)) { & $json 400 @{ error = ("'" + $val + "' is not one of the choices for '" + [string]$f.label + "'.") }; return }
      $values[[string]$f.key] = $val
    }
    if ($missing.Count) { & $json 400 @{ error = ('Fill in: ' + ($missing -join ', ')) }; return }
    $seq = [int]$meta.seq + 1
    $meta | Add-Member -NotePropertyName seq -NotePropertyValue $seq -Force
    $startDate = [datetime]::ParseExact($start, 'yyyy-MM-dd', [cultureinfo]::InvariantCulture)
    $dues = @(ConvertTo-List $body.dues)
    $steps = New-Object System.Collections.Generic.List[object]
    $acc = 0; $i = 0
    foreach ($s in (ConvertTo-List $proc.steps)) {
      $acc += [int]$s.days
      $due = $startDate.AddDays($acc).ToString('yyyy-MM-dd')
      if ($i -lt $dues.Count -and (Test-IsoDate ([string]$dues[$i]))) { $due = [string]$dues[$i] }
      $slots = @(ConvertTo-List $s.docs | ForEach-Object { [ordered]@{ code = [string]$_; files = @() } })
      $steps.Add([ordered]@{ name = [string]$s.name; due = $due; status = 'todo'; done_utc = ''; docs = $slots })
      $i++
    }
    $proj = [ordered]@{
      id = 'P-' + $seq.ToString('D3'); values = $values; process_id = [string]$proc.id; process_name = [string]$proc.name
      start = $start; created_by = $User; created_utc = [DateTime]::UtcNow.ToString('o'); steps = @($steps.ToArray())
    }
    $projects.Add($proj)
    Write-JsonFile -Path $metaPath -Object $meta
    Write-VaultProjects -Vault $v -Projects $projects.ToArray()
    Add-VaultLog -Vault $v -User $User -Action 'Project_Register' -Detail $proj.id
    & $json 200 @{ ok = $true; project_id = $proj.id; projects = @(Read-VaultProjects $v) }
    return
  }

  $proj = $null
  foreach ($p in $projects) { if ([string]$p.id -eq [string]$body.project_id) { $proj = $p } }
  if (-not $proj) { & $json 404 @{ error = 'That project is not in this vault.' }; return }

  if ($verb -eq 'project-update') {
    if ($null -ne $body.values) {
      foreach ($f in $fieldDefs) {
        if ($body.values.PSObject.Properties.Name -notcontains [string]$f.key) { continue }
        $val = ([string]$body.values.([string]$f.key)).Trim()
        if ($f.required -and -not $val) { & $json 400 @{ error = ("'" + [string]$f.label + "' is required.") }; return }
        $proj.values | Add-Member -NotePropertyName ([string]$f.key) -NotePropertyValue $val -Force
      }
    }
    $inSteps = @(ConvertTo-List $body.steps)
    $cur = @(ConvertTo-List $proj.steps)
    for ($i = 0; $i -lt $cur.Count -and $i -lt $inSteps.Count; $i++) {
      $s = $inSteps[$i]
      if ($s.due -and (Test-IsoDate ([string]$s.due))) { $cur[$i].due = [string]$s.due }
      $st = [string]$s.status
      if (@('todo', 'doing', 'done') -contains $st -and $st -ne [string]$cur[$i].status) {
        $cur[$i].status = $st
        $cur[$i] | Add-Member -NotePropertyName done_utc -NotePropertyValue $(if ($st -eq 'done') { [DateTime]::UtcNow.ToString('o') } else { '' }) -Force
      }
    }
    Write-VaultProjects -Vault $v -Projects $projects.ToArray()
    Add-VaultLog -Vault $v -User $User -Action 'Project_Update' -Detail ([string]$proj.id)
    & $json 200 @{ ok = $true; projects = @(Read-VaultProjects $v) }
    return
  }
  if ($verb -eq 'project-delete') {
    # The register entry goes; documents already filed stay on disk.
    $kept = @($projects | Where-Object { [string]$_.id -ne [string]$proj.id })
    Write-VaultProjects -Vault $v -Projects $kept
    Add-VaultLog -Vault $v -User $User -Action 'Project_Delete' -Detail ([string]$proj.id)
    & $json 200 @{ ok = $true; projects = @(Read-VaultProjects $v) }
    return
  }

  $steps = @(ConvertTo-List $proj.steps)
  $si = -1
  [void][int]::TryParse(([string]$body.step_index), [ref]$si)
  if ($null -eq $body.step_index -or $si -lt 0 -or $si -ge $steps.Count) { & $json 400 @{ error = 'Unknown step.' }; return }
  $step = $steps[$si]
  $slot = $null
  foreach ($d in (ConvertTo-List $step.docs)) { if ([string]$d.code -eq [string]$body.code) { $slot = $d } }
  if (-not $slot) { & $json 400 @{ error = 'This step does not expect that document type.' }; return }

  if ($verb -eq 'upload') {
    $bytes = [Convert]::FromBase64String([string]$body.contentBase64)
    if ($bytes.Length -gt 25MB) { & $json 400 @{ error = 'File exceeds the 25 MB limit.' }; return }
    $original = Get-SafeName ([System.IO.Path]::GetFileName([string]$body.fileName))
    if (-not $original) { & $json 400 @{ error = 'The file has no name.' }; return }
    $relDir = Resolve-VaultFolder -Meta $meta -Project $proj -ProcessName ([string]$proj.process_name) -StepName ([string]$step.name) -Code ([string]$slot.code)
    $destDir = if ($relDir) { Join-Path $v.dir $relDir } else { $v.dir }
    if (-not (Test-Path -LiteralPath $destDir)) { New-Item -ItemType Directory -Path $destDir -Force | Out-Null }
    $shaAlg = [System.Security.Cryptography.SHA256]::Create()
    try { $sha = ([BitConverter]::ToString($shaAlg.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant() } finally { $shaAlg.Dispose() }
    # Keep the name the user gave the file. Only when a DIFFERENT file of the
    # same name is already there does the new one get a short content suffix.
    $name = $original
    $dest = Join-Path $destDir $name
    $duplicate = $false
    if (Test-Path -LiteralPath $dest) {
      $shaAlg = [System.Security.Cryptography.SHA256]::Create()
      try { $have = ([BitConverter]::ToString($shaAlg.ComputeHash([System.IO.File]::ReadAllBytes($dest)))).Replace('-', '').ToLowerInvariant() } finally { $shaAlg.Dispose() }
      if ($have -eq $sha) { $duplicate = $true }
      else {
        $name = [System.IO.Path]::GetFileNameWithoutExtension($original) + '_' + $sha.Substring(0, 8) + [System.IO.Path]::GetExtension($original)
        $dest = Join-Path $destDir $name
      }
    }
    if (-not $duplicate -and -not (Test-Path -LiteralPath $dest)) { [System.IO.File]::WriteAllBytes($dest, $bytes) }
    $relPath = $dest.Substring($v.dir.TrimEnd('\').Length).TrimStart('\')
    $files = New-Object System.Collections.Generic.List[object]
    foreach ($f in (ConvertTo-List $slot.files)) { if ([string]$f.rel_path -ne $relPath) { $files.Add($f) } }
    $files.Add([ordered]@{ name = $name; rel_path = $relPath; sha256 = $sha; bytes = $bytes.Length; by = $User; utc = [DateTime]::UtcNow.ToString('o') })
    $slot.files = @($files.ToArray())
    Write-VaultProjects -Vault $v -Projects $projects.ToArray()
    Add-VaultLog -Vault $v -User $User -Action 'File_Upload' -Detail ([string]$proj.id + ' / ' + [string]$step.name + ' / ' + [string]$slot.code + ' / ' + $name)
    & $json 200 @{ ok = $true; name = $name; rel_path = $relPath; duplicate = $duplicate; projects = @(Read-VaultProjects $v) }
    return
  }
  if ($verb -eq 'unfile') {
    # Takes the file off the project's list. The file itself is left where it
    # is: this app never deletes a document.
    $rel = [string]$body.rel_path
    $slot.files = @(ConvertTo-List $slot.files | Where-Object { [string]$_.rel_path -ne $rel })
    Write-VaultProjects -Vault $v -Projects $projects.ToArray()
    Add-VaultLog -Vault $v -User $User -Action 'File_Unlist' -Detail ([string]$proj.id + ' / ' + $rel)
    & $json 200 @{ ok = $true; projects = @(Read-VaultProjects $v) }
    return
  }
  & $json 404 @{ error = 'not found' }
}

# ---------------------------------------------------------------- server --
$listener = New-Object System.Net.HttpListener
$boundPort = $null
# The parentheses around each arithmetic term are load-bearing. Written as
# @($Port, $Port + 1, $Port + 2) PowerShell does NOT parse three elements - it
# parses FIVE: $Port, $Port, +1, $Port, +2, reading the '+' as a unary sign on
# the following element rather than as addition. The fallback therefore retried
# 8080 three times and then tried privileged ports 1 and 2, which always fail
# with "Access is denied" - so the advertised 8080->8081->8082 fallback had
# never once worked, and a busy 8080 killed the launcher outright.
$portCandidates = @($Port, ($Port + 1), ($Port + 2))
foreach ($tryPort in $portCandidates) {
  try {
    $listener = New-Object System.Net.HttpListener
    # HTTP.sys matches a request's Host header against a registered prefix
    # literally - a request to 127.0.0.1 does not match a "localhost" prefix
    # and HTTP.sys itself rejects it with a 400 "Invalid Hostname" page before
    # this script's routing (and Test-LoopbackRequest) ever run. Registering
    # every loopback form means the app works regardless of which one a
    # browser, bookmark or script happens to use. All three are still
    # strictly loopback-only, so "no remote client can arrive here" - the
    # property Test-LoopbackRequest asserts below - is unchanged.
    $listener.Prefixes.Add("http://localhost:$tryPort/")
    $listener.Prefixes.Add("http://127.0.0.1:$tryPort/")
    try { $listener.Prefixes.Add("http://[::1]:$tryPort/") } catch { }
    $listener.Start()
    $boundPort = $tryPort
    break
  } catch {
    Write-Log ("Could not bind port $tryPort : " + $_.Exception.Message) 'WARN'
  }
}
if (-not $boundPort) {
  Write-Log ('Could not bind any port (' + ($portCandidates -join ', ') + '). Exiting.') 'ERROR'
  try { $mutex.ReleaseMutex() } catch { }
  exit 1
}
Write-Log ("Listening on http://localhost:$boundPort/")
if (-not $NoBrowser) { Start-Process ("http://localhost:$boundPort/") }

try { Initialize-Auth } catch { Write-Log ('Auth initialisation failed: ' + $_.Exception.Message) 'ERROR' }
Initialize-VaultSettings

try {
  while ($listener.IsListening) {
    $context = $listener.GetContext()
    $req = $context.Request
    $res = $context.Response
    $script:ReqUser = ''
    try {
      $path = $req.Url.AbsolutePath
      $method = $req.HttpMethod

      # v12: who is asking. A session that still carries a temporary password
      # may only reach /api/auth/* (to replace it) - it is treated as signed
      # out everywhere else.
      $sess = Get-RequestSession -Request $req
      $signedIn = [bool]($sess -and -not $sess.must_change)
      if ($signedIn) { $script:ReqUser = [string]$sess.user }
      $isApi = $path -like '/api/*'
      # /api/shutdown stays reachable without a session: Stop_Server.cmd calls
      # it, and it is already limited to this machine (Test-LoopbackRequest).
      $openApi = ($path -like '/api/auth/*') -or ($path -eq '/api/shutdown')

      if ($isApi -and -not $openApi -and -not $signedIn) {
        New-JsonResponse -Response $res -StatusCode 401 -Body @{ error = 'Sign in first.'; auth = 'required' }
      }
      elseif ($path -like '/api/auth/*') {
        Invoke-AuthApi -Req $req -Res $res -Path $path -Method $method -Session $sess
      }
      elseif ($path -eq '/api/vaults' -or $path -like '/api/vaults/*') {
        Invoke-VaultApi -Req $req -Res $res -Path $path -Method $method -User $script:ReqUser
      }
      elseif ($method -eq 'GET' -and $path -eq '/login.html') {
        New-FileResponse -Response $res -Path (Join-Path $SystemDir 'login.html') -ContentType $MimeTypes['.html']
      }
      elseif ($method -eq 'GET' -and ($path -eq '/' -or $path -eq '/index.html' -or $path -eq '/vault.html')) {
        # The app pages themselves are only handed to a signed-in browser;
        # anyone else lands on the login page.
        if (-not $signedIn) { New-RedirectResponse -Response $res -Location '/login.html' }
        else {
          $page = if ($path -eq '/vault.html') { 'vault.html' } else { 'index.html' }
          New-FileResponse -Response $res -Path (Join-Path $SystemDir $page) -ContentType $MimeTypes['.html']
        }
      }
      elseif ($method -eq 'GET' -and $path -match '^/(styles\.css|app\.js|v12\.css|v12-shared\.js|login\.js|vault\.js)$') {
        $file = Join-Path $SystemDir $Matches[1]
        $ext = [System.IO.Path]::GetExtension($file)
        New-FileResponse -Response $res -Path $file -ContentType $MimeTypes[$ext]
      }
      # v12.1: the app icon (the same file the desktop shortcut uses), as the
      # browser-tab icon. Open without a session - the login page shows it too.
      elseif ($method -eq 'GET' -and $path -eq '/favicon.ico') {
        New-FileResponse -Response $res -Path (Join-Path $SystemDir 'assets\wvn_stage_gate.ico') -ContentType 'image/x-icon'
      }
      # Vendored Tabler assets (v3.0) — narrow allowlist, same pattern as the
      # styles.css/app.js route above, not a generic static-file server. Only
      # the two files index.html actually references are reachable.
      elseif ($method -eq 'GET' -and $path -match '^/vendor/tabler/(css/tabler\.min\.css|js/tabler\.min\.js)$') {
        $file = Join-Path $SystemDir ('vendor\tabler\' + ($Matches[1] -replace '/', '\'))
        $ext = [System.IO.Path]::GetExtension($file)
        New-FileResponse -Response $res -Path $file -ContentType $MimeTypes[$ext]
      }
      elseif ($method -eq 'GET' -and $path -eq '/api/data') {
        $cfg = Get-Config
        # v11: runtime value, never stored (see "deployment path" above).
        if ($cfg.system_info) { $cfg.system_info | Add-Member -NotePropertyName deployment_path -NotePropertyValue $RootDir -Force }
        # v12: the old plain-text PIN (still in config.json until the admin
        # first changes their password) is never sent to a browser.
        if ($cfg.PSObject.Properties.Name -contains 'admin_pin') { $cfg.PSObject.Properties.Remove('admin_pin') }
        New-JsonResponse -Response $res -StatusCode 200 -Body @{
          config = $cfg; tracking = (Get-AllTracking)
          session = (Get-SessionInfo $sess)
          folder_levels = @(Get-EvidenceLevels $cfg); folder_tokens = $EvidenceLevelTokens
          paths = @{ root = $RootDir; vault = $EvidenceDir; templates = $TemplatesDir }
          storage = @{ mode = 'journal'; writer = $WriterId; tag = $WriterTag; warnings = @($script:StorageWarnings.Values) }
        }
      }
      elseif ($method -eq 'GET' -and $path -eq '/api/document-history') {
        # v11 R1: one document's revisions, newest first. Scoped on purpose -
        # the browser never filters the whole store for this, and the contract
        # stays the same when lb_deliverables is partitioned later.
        # v12: Get-QueryValue, not $req.QueryString - the latter decodes with the
        # request's content encoding, which a GET does not have, so a Vietnamese
        # part name or search word arrived as mojibake and matched nothing.
        $qp = (Get-QueryValue -Request $req -Name 'project_id'); $qs = (Get-QueryValue -Request $req -Name 'step_key'); $qd = (Get-QueryValue -Request $req -Name 'doc_code')
        # v11.1: optional - defaults to '' (the one part every pre-v11.1 row
        # and every single-file document has), so an old caller that never
        # heard of parts still gets exactly the rows it used to get.
        $qpart = (Get-QueryValue -Request $req -Name 'part_id')
        if (-not $qp -or -not $qs -or -not $qd) {
          New-JsonResponse -Response $res -StatusCode 400 -Body @{ error = 'project_id, step_key and doc_code are all required.' }
        } else {
          $docRows = @(Read-Store 'lb_deliverables' | Where-Object { $_.project_id -ceq $qp -and $_.step_key -ceq $qs -and $_.doc_code -ceq $qd -and [string]$_.part_id -ceq $qpart })
          $revs = @($docRows | Where-Object { $_.revision_no } | Sort-Object { [int]$_.revision_no } -Descending)
          $apprs = @(Read-Store 'lb_approvals' | Where-Object { $_.project_id -ceq $qp -and $_.step_key -ceq $qs })
          $appr = if ($apprs.Count) { $apprs[$apprs.Count - 1] } else { $null }
          $stale = Get-StaleApprovalMap -Config (Get-Config) -Approvals $apprs -Deliverables $docRows
          New-JsonResponse -Response $res -StatusCode 200 -Body @{
            project_id = $qp; step_key = $qs; doc_code = $qd; part_id = $qpart
            revisions = $revs
            removed = [bool](@($docRows | Where-Object { $_.status -eq 'Removed' }).Count)
            approval = $appr
            stale = [bool]$stale.Count
          }
        }
      }
      elseif ($method -eq 'POST' -and $path -eq '/api/deliverables/batch') {
        # v11 R2: the ROW half of a bulk upload. The browser uploads each file
        # through /api/upload (retried on its own), then sends the rows here in
        # chunks of at most 20: one journal append for the rows and one for
        # their audit entries, however many files are in the chunk.
        # Idempotent: a row identical to the document's ACTIVE revision (same
        # SHA-256) is reported back as a duplicate, not written again - so a
        # retry after a lost response never mints a second revision, while
        # deliberately re-filing an OLDER revision's content still works.
        $body = Read-JsonBody -Request $req
        $inRows = @($body.rows)
        $who = [string]$body.user
        if ($inRows.Count -eq 0 -or $inRows.Count -gt 20) {
          New-JsonResponse -Response $res -StatusCode 400 -Body @{ error = ('Send between 1 and 20 rows per request (got ' + $inRows.Count + ').') }
        } else {
          $activeSha = @{}
          foreach ($r in @(Read-Store 'lb_deliverables')) {
            # v11.1: keyed by part_id too - two parts of the same doc_code have
            # independent active revisions, so a duplicate check must compare
            # against the SAME part's active file, not just any part's.
            if ($r.is_active -eq 'YES' -and $r.sha256) { $activeSha[[string]$r.project_id + '|' + [string]$r.step_key + '|' + [string]$r.doc_code + '|' + [string]$r.part_id] = @{ sha = [string]$r.sha256; id = [string]$r.deliverable_id } }
          }
          $results = New-Object System.Collections.Generic.List[object]
          $toAdd = New-Object System.Collections.Generic.List[object]
          $slots = New-Object System.Collections.Generic.List[int]
          foreach ($row in $inRows) {
            $h = ConvertTo-Hashtable $row
            $h.Remove('deliverable_id')
            $k = [string]$h['project_id'] + '|' + [string]$h['step_key'] + '|' + [string]$h['doc_code'] + '|' + [string]$h['part_id']
            if (-not $h['project_id'] -or -not $h['step_key'] -or -not $h['doc_code']) {
              $results.Add(@{ ok = $false; error = 'project_id, step_key and doc_code are required.' }); continue
            }
            $cur = $activeSha[$k]
            if ($cur -and $h['sha256'] -and ([string]$h['sha256']) -eq $cur.sha) {
              $results.Add(@{ ok = $true; id = $cur.id; duplicate = $true }); continue
            }
            if ($h['sha256']) { $activeSha[$k] = @{ sha = [string]$h['sha256']; id = '' } }
            $slots.Add($results.Count)
            $results.Add(@{ ok = $true; id = ''; duplicate = $false })
            $toAdd.Add($h)
          }
          if ($toAdd.Count) {
            $ids = @(Add-StoreRowsBatch -Store 'lb_deliverables' -Rows $toAdd.ToArray() -IdField 'deliverable_id')
            $audits = New-Object System.Collections.Generic.List[object]
            for ($i = 0; $i -lt $toAdd.Count; $i++) {
              $results[$slots[$i]].id = $ids[$i]
              $h = $toAdd[$i]
              $act = if ($h['change_reason']) { 'Upload_New_Revision' } else { 'File_Evidence' }
              $audits.Add((New-AuditVersion -User $who -Action $act -ProjectId ([string]$h['project_id']) -ObjType 'Deliverable' -ObjId $ids[$i] -From ([string]$h['original_name']) -To ([string]$h['status']) -Detail ([string]$h['doc_code'] + $(if ($h['change_reason']) { ' - ' + [string]$h['change_reason'] } else { '' }))))
            }
            Add-JournalVersions -Store 'lb_audit' -Versions $audits.ToArray()
          }
          New-JsonResponse -Response $res -StatusCode 200 -Body @{ results = $results.ToArray() }
        }
      }
      elseif ($method -eq 'GET' -and $path -eq '/api/vault/data') {
        # v12.2: what the vault itself holds (project register, progress,
        # settings), for Settings -> Project data in the vault.
        New-JsonResponse -Response $res -StatusCode 200 -Body (Get-VaultDataStatus)
      }
      elseif ($method -eq 'POST' -and ($path -eq '/api/vault/data/export' -or $path -eq '/api/vault/data/open')) {
        # Rewrites the readable Excel copy now (export) and, for 'open',
        # launches it in Excel on this PC. Opening is a local-only action,
        # like /api/open-path.
        $opening = ($path -eq '/api/vault/data/open')
        if ($opening -and -not (Test-LoopbackRequest -Request $req)) {
          New-JsonResponse -Response $res -StatusCode 403 -Body @{ error = 'This action may only be requested from this machine.' }
        } else {
          $out = Update-InfoWorkbook -Force
          if (-not $out) {
            New-JsonResponse -Response $res -StatusCode 409 -Body @{ error = 'The Excel file could not be written. If it is open in Excel, close it and try again.' }
          } else {
            if ($opening) {
              try { Start-Process -FilePath $out } catch { Write-Log ('Could not open ' + $out + ': ' + $_.Exception.Message) 'WARN' }
            }
            New-JsonResponse -Response $res -StatusCode 200 -Body @{ ok = $true; path = $out }
          }
        }
      }
      elseif ($method -eq 'POST' -and $path -eq '/api/vault/data/snapshot') {
        $body = Read-JsonBody -Request $req
        $actor = [string]$body.user
        if (-not (Test-AdminName $actor)) {
          New-JsonResponse -Response $res -StatusCode 403 -Body @{ error = 'Only the admin user can save the settings into the vault.' }
        } elseif (-not $VaultConfigDir) {
          New-JsonResponse -Response $res -StatusCode 409 -Body @{ error = 'The vault data folder is not writable on this PC.' }
        } else {
          $cfg = Get-Config
          Save-ConfigSnapshot -ConfigObj $cfg -By $actor
          Add-Audit -User $actor -Action 'Config_Snapshot_To_Vault' -ProjectId '' -ObjType 'Config' -ObjId 'settings' -From '' -To 'vault' -Detail ''
          New-JsonResponse -Response $res -StatusCode 200 -Body @{ ok = $true }
        }
      }
      elseif ($method -eq 'POST' -and $path -eq '/api/vault/data/restore') {
        # Applies the newest settings saved in this vault to this app copy -
        # the step after pointing a new version of the app at an existing
        # vault. This PC's own vault location and app version are kept; the
        # config.json being replaced is first copied beside it.
        $body = Read-JsonBody -Request $req
        $actor = [string]$body.user
        if (-not (Test-AdminName $actor)) {
          New-JsonResponse -Response $res -StatusCode 403 -Body @{ error = 'Only the admin user can restore settings from the vault.' }
        } else {
          $cfg = Get-Config
          $snaps = @(Get-ConfigSnapshots | Sort-Object { $_.saved_utc } -Descending)
          $pick = $null
          if ([string]$body.writer) { $pick = @($snaps | Where-Object { $_.writer -eq [string]$body.writer }) | Select-Object -First 1 }
          else { $pick = $snaps | Select-Object -First 1 }
          if (-not $pick) {
            New-JsonResponse -Response $res -StatusCode 404 -Body @{ error = 'This vault has no saved settings.' }
          } else {
            $new = $pick.config
            foreach ($k in 'evidence_vault_path', 'evidence_vault_root', 'evidence_vault_folder_name', 'evidence_vault_relative_to_root') {
              if ($cfg.deployment_defaults.PSObject.Properties.Name -contains $k) { $new.deployment_defaults | Add-Member -NotePropertyName $k -NotePropertyValue $cfg.deployment_defaults.$k -Force }
              else { $new.deployment_defaults.PSObject.Properties.Remove($k) }
            }
            foreach ($k in 'version', 'deployment_path') {
              if ($cfg.system_info.PSObject.Properties.Name -contains $k) { $new.system_info | Add-Member -NotePropertyName $k -NotePropertyValue $cfg.system_info.$k -Force }
            }
            $bk = Join-Path $SystemDir ('config.before_restore_' + (Get-Date -Format 'yyyyMMdd_HHmmss') + '.json')
            Copy-Item -LiteralPath $ConfigPath -Destination $bk -Force
            Save-Config $new
            Add-Audit -User $actor -Action 'Config_Restore_From_Vault' -ProjectId '' -ObjType 'Config' -ObjId 'settings' -From ([string]$cfg.settings_saved_utc) -To $pick.saved_utc -Detail ('saved by ' + $pick.by + ' on ' + $pick.writer + ' (v' + $pick.app_version + ')')
            Write-Log ('Settings restored from the vault snapshot of ' + $pick.writer + ' (' + $pick.saved_utc + '); previous config kept as ' + $bk)
            New-JsonResponse -Response $res -StatusCode 200 -Body @{ ok = $true; backup = $bk }
          }
        }
      }
      elseif ($method -eq 'GET' -and $path -eq '/api/vault/orphans') {
        # v11 R2 (surfaced on the Input tab in v11.1): files in the vault that
        # no tracking row points at - either the "file saved, row never
        # written" failure the upload queue exists to prevent, or someone
        # pasting a file straight into the vault folder in Explorer, bypassing
        # the app (and its audit trail) entirely. Read-only; nothing here is
        # moved, renamed or deleted - "Categorize" (POST /api/action on
        # lb_deliverables with this exact path) registers it in place, and
        # "Ignore" (POST /api/action on lb_vault_ignored) just remembers that
        # a human looked at it and it is not a deliverable.
        $refs = @{}
        foreach ($pair in @(@('lb_deliverables', 'file_path'), @('lb_issues', 'evidence_path'), @('lb_sp_issues', 'attachment_path'), @('lb_mwer', 'evidence_file'))) {
          foreach ($r in @(Read-Store $pair[0])) {
            $v = [string]$r.($pair[1])
            if ($v -and -not ($v -match '^[a-zA-Z][a-zA-Z0-9+.-]*://')) { try { $refs[[System.IO.Path]::GetFullPath((ConvertFrom-StoredPath $v))] = $true } catch { } }
          }
        }
        $ignored = @{}
        foreach ($r in @(Read-Store 'lb_vault_ignored')) { if ($r.file_path) { $ignored[[string]$r.file_path] = $r } }
        $cfg = Get-Config
        # v12.2: <vault>\_vault is the project data, not documents
        $dataPrefix = $EvidenceDir.TrimEnd('\') + '\_vault\'
        $all = @(if (Test-Path -LiteralPath $EvidenceDir) { Get-ChildItem -LiteralPath $EvidenceDir -Recurse -File -ErrorAction SilentlyContinue | Where-Object { -not $_.FullName.StartsWith($dataPrefix, [StringComparison]::OrdinalIgnoreCase) -and -not ($_.Name -like 'Project_Information*' -and $_.DirectoryName.TrimEnd('\') -eq $EvidenceDir.TrimEnd('\')) } })
        $orph = New-Object System.Collections.Generic.List[object]
        $ignoredCount = 0
        foreach ($f in $all) {
          if ($refs.ContainsKey($f.FullName)) { continue }
          $rel = $f.FullName.Substring($EvidenceDir.TrimEnd('\').Length).TrimStart('\')
          if ($ignored.ContainsKey($rel)) { $ignoredCount++; continue }
          $owner = ''
          try { $owner = (Get-Acl -LiteralPath $f.FullName).Owner } catch { }
          $sha = ''
          # A hash is nice-to-have (lets "Categorize" dedupe like a normal
          # upload) but not worth stalling the whole list over one huge file.
          if ($f.Length -le 50MB) {
            try {
              $shaAlg = [System.Security.Cryptography.SHA256]::Create()
              try { $sha = ([BitConverter]::ToString($shaAlg.ComputeHash([System.IO.File]::ReadAllBytes($f.FullName)))).Replace('-', '').ToLowerInvariant() }
              finally { $shaAlg.Dispose() }
            } catch { }
          }
          $orph.Add(@{
            path = $rel; bytes = $f.Length; modified_utc = $f.LastWriteTimeUtc.ToString('o')
            created_utc = $f.CreationTimeUtc.ToString('o'); owner = $owner; sha256 = $sha
            guess = Get-OrphanGuess -Config $cfg -RelPath $rel
          })
        }
        New-JsonResponse -Response $res -StatusCode 200 -Body @{ vault = $EvidenceDir; files = $all.Count; ignored = $ignoredCount; orphans = $orph.ToArray() }
      }
      elseif ($method -eq 'POST' -and $path -eq '/api/vault/orphans/adopt') {
        # v11.1: registers a stray vault file as a deliverable, exactly the
        # way /api/action on lb_deliverables always could - EXCEPT this also
        # renames the file to the current naming standard first, when asked
        # (standardize=true). "Keep original name" (standardize=false) is the
        # same as before: register it exactly where it sits, untouched.
        # Standardizing renames it IN PLACE (Move-Item within the same
        # folder - the folder is already right, or the client would not have
        # been able to guess a doc type from it) rather than routing back
        # through Save-Evidence, so a stray file that is not byte-identical
        # to anything already filed can never be treated as a duplicate of
        # itself and silently skipped.
        $body = Read-JsonBody -Request $req
        $who = [string]$body.user
        if (-not $who) {
          New-JsonResponse -Response $res -StatusCode 400 -Body @{ error = 'A name is required.' }
        } else {
        $relPath = [string]$body.path
        $projectId = [string]$body.project_id; $stepKey = [string]$body.step_key; $docCode = [string]$body.doc_code
        $partId = [string]$body.part_id
        if (-not $relPath -or -not $projectId -or -not $stepKey -or -not $docCode) {
          New-JsonResponse -Response $res -StatusCode 400 -Body @{ error = 'path, project_id, step_key and doc_code are all required.' }
        } else {
          $srcPath = Join-Path $EvidenceDir $relPath
          if (-not (Test-Path -LiteralPath $srcPath)) {
            New-JsonResponse -Response $res -StatusCode 404 -Body @{ error = 'That file is no longer in the vault - it may already have been categorized or removed.' }
          } else {
            $proj = @(Read-Store 'lb_projects' | Where-Object { $_.project_id -eq $projectId }) | Select-Object -First 1
            $family = if ($proj) { [string]$proj.family } else { '' }
            $sha = [string]$body.sha256
            if (-not $sha) {
              $shaAlg = [System.Security.Cryptography.SHA256]::Create()
              try { $sha = ([BitConverter]::ToString($shaAlg.ComputeHash([System.IO.File]::ReadAllBytes($srcPath)))).Replace('-', '').ToLowerInvariant() } finally { $shaAlg.Dispose() }
            }
            $finalPath = $srcPath
            $finalName = [System.IO.Path]::GetFileName($srcPath)
            if ($body.standardize) {
              $stdName = Get-StandardFileName -DocType $docCode -Model $family -WvnId '' -WnbId '' -Description '' `
                           -OriginalName $finalName -Category $partId -ProjectId $projectId -Config (Get-Config)
              $ext = [System.IO.Path]::GetExtension($stdName)
              $stem = [System.IO.Path]::GetFileNameWithoutExtension($stdName)
              $finalName = (Get-SafeName $stem) + '_' + $sha.Substring(0, [Math]::Min(8, $sha.Length)) + $ext
              $newPath = Join-Path (Split-Path -Parent $srcPath) $finalName
              if ($newPath -ne $srcPath) {
                if (Test-Path -LiteralPath $newPath) {
                  New-JsonResponse -Response $res -StatusCode 409 -Body @{ error = "A file named '$finalName' already exists there - resolve that by hand first." }
                  $finalPath = $null
                } else {
                  Move-Item -LiteralPath $srcPath -Destination $newPath
                  $finalPath = $newPath
                }
              }
            }
            if ($finalPath) {
              $row = @{
                project_id = $projectId; step_key = $stepKey; doc_code = $docCode; part_id = $partId
                file_name = $finalName; file_path = $finalPath; sha256 = $sha; status = 'Filed'; kind = 'file'
                uploaded_by = $who; uploaded_utc = (Get-Date).ToUniversalTime().ToString('o')
                notes = 'Found already in the vault, not filed through this app - categorized' + $(if ($body.standardize) { ' and renamed to the naming standard.' } else { ' in place.' })
              }
              $saved = Add-StoreRow -Store 'lb_deliverables' -Row $row -IdField 'deliverable_id'
              Add-Audit -User $who -Action 'Categorize_Orphan' -ProjectId $projectId -ObjType 'Deliverable' -ObjId $docCode -From 'Uncategorized' -To 'Filed' -Detail $relPath
              New-JsonResponse -Response $res -StatusCode 200 -Body @{ ok = $true; deliverable_id = $saved.deliverable_id; file_name = $finalName; file_path = $finalPath }
            }
          }
        }
        }
      }
      elseif ($method -eq 'GET' -and $path -eq '/api/vault/search') {
        # v11 R3: one row per DOCUMENT (project + step + doc type), its active
        # revision inline, filtered and paged on the server. The index is
        # rebuilt only when a contributing store changes; this contract is
        # what a partitioned lb_deliverables would sit behind later.
        $cfg = Get-Config
        $docsIdx = Get-VaultIndex -Config $cfg
        $qv = { param($n) (Get-QueryValue -Request $req -Name $n).Trim() }
        $fq = (& $qv 'q').ToLowerInvariant()
        $fPillar = & $qv 'pillar'; $fFam = & $qv 'family'; $fDoc = & $qv 'doc'; $fPic = & $qv 'pic'; $fDept = & $qv 'dept'
        $fFrom = & $qv 'from'; $fTo = & $qv 'to'; $fStatus = & $qv 'status'; $fStale = (& $qv 'stale') -eq '1'
        $size = 50; try { $size = [Math]::Max(1, [Math]::Min(200, [int](& $qv 'size'))) } catch { $size = 50 }
        if (-not (& $qv 'size')) { $size = 50 }
        $page = 1; try { $page = [Math]::Max(1, [int](& $qv 'page')) } catch { $page = 1 }
        $hits = New-Object System.Collections.Generic.List[object]
        foreach ($d in $docsIdx) {
          if ($fPillar -and $d.process -ne $fPillar) { continue }
          if ($fFam -and $d.prod_family -ne $fFam -and $d.family -ne $fFam) { continue }
          if ($fDoc -and $d.doc_code -ne $fDoc) { continue }
          if ($fPic -and $d.pic -ne $fPic) { continue }
          if ($fDept -and $d.owner_dept -ne $fDept) { continue }
          if ($fStatus -and $d.status -ne $fStatus) { continue }
          if ($fStale -and -not $d.stale) { continue }
          $day = if ($d.date) { ([string]$d.date).Substring(0, [Math]::Min(10, ([string]$d.date).Length)) } else { '' }
          if ($fFrom -and (-not $day -or $day -lt $fFrom)) { continue }
          if ($fTo -and (-not $day -or $day -gt $fTo)) { continue }
          if ($fq -and -not $d.search.Contains($fq)) { continue }
          $hits.Add($d)
        }
        $total = $hits.Count
        $start = ($page - 1) * $size
        $rowsOut = @()
        if ($start -lt $total) { $rowsOut = @($hits.GetRange($start, [Math]::Min($size, $total - $start)) | ForEach-Object { $x = @{}; foreach ($k in $_.Keys) { if ($k -ne 'search') { $x[$k] = $_[$k] } }; $x }) }
        $facet = { param($f) @($docsIdx | ForEach-Object { [string]$_[$f] } | Where-Object { $_ } | Sort-Object -Unique) }
        New-JsonResponse -Response $res -StatusCode 200 -Body @{
          total = $total; page = $page; size = $size; rows = $rowsOut
          facets = @{ pillars = (& $facet 'process'); families = (& $facet 'prod_family'); docs = (& $facet 'doc_code'); pics = (& $facet 'pic'); depts = (& $facet 'owner_dept') }
        }
      }
      elseif ($method -eq 'POST' -and $path -eq '/api/config/pillars') {
        # v11 R4: admin edits the pillar list. Validated as a whole; nothing
        # is saved unless every pillar passes.
        $body = Read-JsonBody -Request $req
        $actor = [string]$body.user
        if ($actor.ToLowerInvariant() -ne 'admin') {
          New-JsonResponse -Response $res -StatusCode 403 -Body @{ error = 'Only the admin user can change pillars.' }
        } else {
          $cfg = Get-Config
          $incoming = @($body.pillars)
          $errs = @(Test-PillarList -Config $cfg -Pillars $incoming)
          if ($errs.Count) {
            New-JsonResponse -Response $res -StatusCode 400 -Body @{ error = ($errs -join ' '); errors = $errs }
          } else {
            $before = @($cfg.pillars | ForEach-Object { [string]$_.process_id }) -join ','
            $cfg | Add-Member -NotePropertyName pillars -NotePropertyValue $incoming -Force
            Save-Config $cfg
            Add-Audit -User $actor -Action 'Config_Pillars_Update' -ProjectId '' -ObjType 'Config' -ObjId 'pillars' -From $before -To (($incoming | ForEach-Object { [string]$_.process_id }) -join ',') -Detail ''
            New-JsonResponse -Response $res -StatusCode 200 -Body @{ ok = $true; pillars = $incoming }
          }
        }
      }
      elseif ($method -eq 'POST' -and $path -eq '/api/config/naming') {
        # v11.1: admin edits the file-naming rules from Settings. Validated as
        # a whole, same pattern as pillars above - nothing is saved unless
        # every rule passes, so a half-edited rule list never reaches disk.
        $body = Read-JsonBody -Request $req
        $actor = [string]$body.user
        if ($actor.ToLowerInvariant() -ne 'admin') {
          New-JsonResponse -Response $res -StatusCode 403 -Body @{ error = 'Only the admin user can change the naming standard.' }
        } else {
          $cfg = Get-Config
          $incoming = @($body.rules)
          $errs = @(Test-NamingRules -Rules $incoming)
          if ($errs.Count) {
            New-JsonResponse -Response $res -StatusCode 400 -Body @{ error = ($errs -join ' '); errors = $errs }
          } else {
            $before = @($cfg.naming.rules | ForEach-Object { [string]$_.id }) -join ','
            $namingObj = [pscustomobject]@{ rules = $incoming }
            $cfg | Add-Member -NotePropertyName naming -NotePropertyValue $namingObj -Force
            Save-Config $cfg
            Add-Audit -User $actor -Action 'Config_Naming_Update' -ProjectId '' -ObjType 'Config' -ObjId 'naming' -From $before -To (($incoming | ForEach-Object { [string]$_.id }) -join ',') -Detail ''
            New-JsonResponse -Response $res -StatusCode 200 -Body @{ ok = $true; naming = $namingObj }
          }
        }
      }
      elseif ($method -eq 'GET' -and $path -eq '/api/config/naming/fields') {
        # The vocabulary the Settings naming-rule builder offers - kept
        # server-side ($NamingFieldDefs) so it can never drift from what
        # Get-StandardFileName actually understands.
        New-JsonResponse -Response $res -StatusCode 200 -Body @{ fields = $script:NamingFieldDefs }
      }
      elseif (($method -eq 'GET' -or $method -eq 'POST') -and $path -eq '/api/config/naming/apply') {
        # v11.1: after saving a naming rule, offer to re-name every EXISTING
        # active document the rule now covers, not just future uploads. GET
        # previews the count (used to word the confirmation dialog); POST
        # actually renames.
        #
        # "Covers" is resolved fresh against the CURRENT rule list, not just
        # the rule's own doc_codes: every doc_code actually in use is run
        # through Get-NamingRule and only the ones that land on THIS rule id
        # are in scope. That is what makes editing the one default rule (an
        # empty doc_codes list) safe - a document whose code is still claimed
        # by a more specific rule is never touched.
        $cfg = Get-Config
        $postBody = $null
        if ($method -eq 'POST') { $postBody = Read-JsonBody -Request $req }
        $ruleId = if ($method -eq 'GET') { (Get-QueryValue -Request $req -Name 'rule_id') } else { [string]$postBody.rule_id }
        $rule = @($cfg.naming.rules) | Where-Object { [string]$_.id -eq $ruleId } | Select-Object -First 1
        if (-not $rule) {
          New-JsonResponse -Response $res -StatusCode 404 -Body @{ error = "Naming rule '$ruleId' not found." }
        } else {
          $delivs = @(Read-Store 'lb_deliverables' | Where-Object { $_.is_active -eq 'YES' -and $_.kind -ne 'link' -and $_.file_name })
          $inUse = @($delivs | ForEach-Object { [string]$_.doc_code } | Select-Object -Unique)
          $affectedCodes = @{}
          foreach ($code in $inUse) {
            $r2 = Get-NamingRule -Config $cfg -DocCode $code
            if ($r2 -and [string]$r2.id -eq $ruleId) { $affectedCodes[$code] = $true }
          }
          $rows = @($delivs | Where-Object { $affectedCodes.ContainsKey([string]$_.doc_code) })
          if ($method -eq 'GET') {
            New-JsonResponse -Response $res -StatusCode 200 -Body @{ rule_id = $ruleId; documents = $rows.Count }
          } else {
            $actor = [string]$postBody.user
            if ($actor.ToLowerInvariant() -ne 'admin') {
              New-JsonResponse -Response $res -StatusCode 403 -Body @{ error = 'Only the admin user can rename existing documents.' }
            } else {
              $projects = @(Read-Store 'lb_projects'); $projById = @{}
              foreach ($p in $projects) { $projById[[string]$p.project_id] = $p }
              $renamed = 0; $skipped = 0; $errs = New-Object System.Collections.Generic.List[string]
              foreach ($r in $rows) {
                try {
                  $proj = $projById[[string]$r.project_id]
                  $family = if ($proj) { [string]$proj.family } else { '' }
                  $newStd = Get-StandardFileName -DocType $r.doc_code -Model $family -WvnId $r.wvn_id -WnbId $r.wnb_id `
                              -Description $r.description -OriginalName $r.file_name -Category $r.part_id -ProjectId $r.project_id -Config $cfg
                  $oldPath = [string]$r.file_path
                  if (-not $oldPath -or -not (Test-Path -LiteralPath $oldPath)) { $skipped++; continue }
                  $ext = [System.IO.Path]::GetExtension($oldPath)
                  $stem = [System.IO.Path]::GetFileNameWithoutExtension($newStd)
                  # the content-hash suffix Save-Evidence appended stays - it is
                  # what keeps two PCs filing the same bytes from colliding, and
                  # a rename is not a new upload so nothing re-derives it.
                  $suffix = if ($r.sha256) { '_' + $r.sha256.Substring(0, [Math]::Min(8, $r.sha256.Length)) } else { '' }
                  $finalName = (Get-SafeName $stem) + $suffix + $ext
                  if ($finalName -eq [System.IO.Path]::GetFileName($oldPath)) { $skipped++; continue }
                  $newPath = Join-Path (Split-Path -Parent $oldPath) $finalName
                  if (Test-Path -LiteralPath $newPath) { $skipped++; continue }
                  Move-Item -LiteralPath $oldPath -Destination $newPath
                  Set-StoreRow -Store 'lb_deliverables' -Row @{ deliverable_id = [string]$r.deliverable_id; file_name = $finalName; file_path = $newPath } -KeyFields @('deliverable_id') | Out-Null
                  $renamed++
                } catch { $errs.Add(([string]$r.deliverable_id) + ': ' + $_.Exception.Message) }
              }
              Add-Audit -User $actor -Action 'Naming_Apply_Existing' -ProjectId '' -ObjType 'Config' -ObjId $ruleId -From '' -To '' -Detail ("renamed=$renamed skipped=$skipped errors=$($errs.Count)")
              New-JsonResponse -Response $res -StatusCode 200 -Body @{ ok = $true; scanned = $rows.Count; renamed = $renamed; skipped = $skipped; errors = $errs.ToArray() }
            }
          }
        }
      }
      elseif ($method -eq 'GET' -and $path -eq '/api/config') {
        $cfg = Get-Config
        if ($cfg.PSObject.Properties.Name -contains 'admin_pin') { $cfg.PSObject.Properties.Remove('admin_pin') }
        New-JsonResponse -Response $res -StatusCode 200 -Body $cfg
      }
      elseif ($method -eq 'POST' -and $path -eq '/api/config/family') {
        # v3.6: renamed field-for-field to match the corrected schema. Also
        # fixed a real bug in the delete guard below - it compared against
        # lb_projects.family_id, which (both before and, by name, still after
        # this rename) has never held a category id; the category link on a
        # project lives in prod_family. The guard was comparing the wrong
        # column and so never actually blocked a referenced category from
        # being deleted.
        $body = Read-JsonBody -Request $req
        $cfg = Get-Config
        $list = @($cfg.prod_families)
        if ($body.op -eq 'add') {
          $list = @($list | Where-Object { $_.prod_family_id -ne $body.prodFamily.prod_family_id }) + ,$body.prodFamily
          $cfg.prod_families = $list
          Save-Config $cfg
          Add-Audit -User $body.user -Action ('Config_Family_' + $body.op) -ProjectId '' -ObjType 'ProdFamily' -ObjId $body.prodFamily.prod_family_id -From '' -To '' -Detail ($body | ConvertTo-Json -Compress)
          New-JsonResponse -Response $res -StatusCode 200 -Body @{ ok = $true; prod_families = $cfg.prod_families }
        } elseif ($body.op -eq 'delete') {
          $referencingProjects = @(Read-Store 'lb_projects' | Where-Object { [string]$_.prod_family -eq $body.prod_family_id })
          if ($referencingProjects.Count -gt 0) {
            $refList = ($referencingProjects | ForEach-Object { $_.project_id }) -join ', '
            New-JsonResponse -Response $res -StatusCode 409 -Body @{
              error = ("Cannot delete product family '" + $body.prod_family_id + "' — it is still referenced by project(s): " + $refList)
            }
          } else {
          $list = @($list | Where-Object { $_.prod_family_id -ne $body.prod_family_id })
          $cfg.prod_families = $list
          Save-Config $cfg
          Add-Audit -User $body.user -Action ('Config_Family_' + $body.op) -ProjectId '' -ObjType 'ProdFamily' -ObjId $body.prod_family_id -From '' -To '' -Detail ($body | ConvertTo-Json -Compress)
          New-JsonResponse -Response $res -StatusCode 200 -Body @{ ok = $true; prod_families = $cfg.prod_families }
          }
        } else { throw "unknown op '$($body.op)'" }
      }
      elseif ($method -eq 'POST' -and $path -eq '/api/config/doctype') {
        $body = Read-JsonBody -Request $req
        $cfg = Get-Config
        $list = @($cfg.document_types)
        if ($body.op -eq 'add') {
          $list = @($list | Where-Object { $_.doctype_id -ne $body.doctype.doctype_id }) + ,$body.doctype
          $cfg.document_types = $list
          Save-Config $cfg
          Add-Audit -User $body.user -Action ('Config_DocType_' + $body.op) -ProjectId '' -ObjType 'DocumentType' -ObjId '' -From '' -To '' -Detail ($body | ConvertTo-Json -Compress)
          New-JsonResponse -Response $res -StatusCode 200 -Body @{ ok = $true; document_types = $cfg.document_types }
        } elseif ($body.op -eq 'delete') {
          $referencingDocs = @(Read-Store 'lb_deliverables' | Where-Object { [string]$_.doc_code -eq $body.doctype_id })
          if ($referencingDocs.Count -gt 0) {
            $refProjects = ($referencingDocs | ForEach-Object { $_.project_id } | Select-Object -Unique) -join ', '
            New-JsonResponse -Response $res -StatusCode 409 -Body @{
              error = ("Cannot delete document type '" + $body.doctype_id + "' — it is still referenced by " + $referencingDocs.Count + " deliverable(s) in project(s): " + $refProjects)
            }
          } else {
          $list = @($list | Where-Object { $_.doctype_id -ne $body.doctype_id })
          $cfg.document_types = $list
          Save-Config $cfg
          Add-Audit -User $body.user -Action ('Config_DocType_' + $body.op) -ProjectId '' -ObjType 'DocumentType' -ObjId '' -From '' -To '' -Detail ($body | ConvertTo-Json -Compress)
          New-JsonResponse -Response $res -StatusCode 200 -Body @{ ok = $true; document_types = $cfg.document_types }
          }
        } else { throw "unknown op '$($body.op)'" }
      }
      elseif ($method -eq 'POST' -and $path -eq '/api/config/moderators') {
        # Moderators inherit admin rights (parallel gate sign-off, task
        # assignment, settings edits). Only 'admin' may change the list -
        # a moderator who could appoint moderators is just an admin.
        $body = Read-JsonBody -Request $req
        $actor = [string]$body.user
        if ($actor.ToLowerInvariant() -ne 'admin') {
          New-JsonResponse -Response $res -StatusCode 403 -Body @{ error = 'Only the admin user can change the moderator list.' }
        } else {
          $cfg = Get-Config
          # Trim, drop blanks, de-duplicate case-insensitively but keep the
          # spelling the admin typed. 'admin' itself is never stored here.
          $seen = @{}
          $clean = New-Object System.Collections.Generic.List[string]
          foreach ($m in @($body.moderators)) {
            $name = ([string]$m).Trim()
            if (-not $name) { continue }
            $k = $name.ToLowerInvariant()
            if ($k -eq 'admin') { continue }
            if ($seen.ContainsKey($k)) { continue }
            $seen[$k] = $true
            $clean.Add($name)
          }
          $before = (@($cfg.moderators) -join ', ')
          $modArray = [string[]]$clean.ToArray()
          if ($cfg.PSObject.Properties.Name -contains 'moderators') {
            $cfg.moderators = $modArray
          } else {
            Add-Member -InputObject $cfg -NotePropertyName 'moderators' -NotePropertyValue $modArray -Force
          }
          Save-Config $cfg
          Add-Audit -User $actor -Action 'Config_Moderators_Update' -ProjectId '' -ObjType 'Config' -ObjId 'moderators' -From $before -To (($clean.ToArray()) -join ', ') -Detail ''
          New-JsonResponse -Response $res -StatusCode 200 -Body @{ ok = $true; moderators = @($clean.ToArray()) }
        }
      }
      elseif ($method -eq 'POST' -and $path -eq '/api/config/user-registry') {
        # The user registry is the single managed roster of valid personnel -
        # the Settings UI saves it here instead of free-typing owner/assignee
        # names. It replaces the whole list (like moderators), and only
        # 'admin' may change it - a moderator who could edit the roster is
        # just an admin.
        $body = Read-JsonBody -Request $req
        $actor = [string]$body.user
        if ($actor.ToLowerInvariant() -ne 'admin') {
          New-JsonResponse -Response $res -StatusCode 403 -Body @{ error = 'Only the admin user can change the user registry.' }
        } else {
          $cfg = Get-Config
          # Trim usernames, drop blanks, de-duplicate case-insensitively but
          # keep the casing the admin typed. Roles outside admin/moderator/
          # user collapse to 'user'; department is optional and defaults to ''.
          $seen = @{}
          $clean = New-Object System.Collections.Generic.List[object]
          foreach ($e in @($body.registry)) {
            $name = ([string]$e.username).Trim()
            if (-not $name) { continue }
            $k = $name.ToLowerInvariant()
            if ($seen.ContainsKey($k)) { continue }
            $seen[$k] = $true
            $role = ([string]$e.role).ToLowerInvariant()
            if ($role -notin @('admin', 'moderator', 'user')) { $role = 'user' }
            $dept = [string]$e.department
            if (-not $dept) { $dept = '' }
            $clean.Add(@{ username = $name; role = $role; department = $dept })
          }
          # The admin account is the one entry that must always exist and
          # always hold role 'admin' - re-add or re-promote it rather than
          # rejecting the roster the admin just submitted.
          $adminIndex = -1
          for ($i = 0; $i -lt $clean.Count; $i++) {
            if (([string]$clean[$i].username).ToLowerInvariant() -eq 'admin') { $adminIndex = $i; break }
          }
          if ($adminIndex -ge 0) {
            if (([string]$clean[$adminIndex].role) -ne 'admin') {
              $clean[$adminIndex] = @{ username = 'admin'; role = 'admin'; department = 'Management' }
            }
          } else {
            $clean.Add(@{ username = 'admin'; role = 'admin'; department = 'Management' })
          }
          $before = (@($cfg.user_registry) | Where-Object { $null -ne $_ } | ForEach-Object { ([string]$_.username) + ':' + ([string]$_.role) }) -join ', '
          $registryArray = @($clean.ToArray())
          if ($cfg.PSObject.Properties.Name -contains 'user_registry') {
            $cfg.user_registry = $registryArray
          } else {
            Add-Member -InputObject $cfg -NotePropertyName 'user_registry' -NotePropertyValue $registryArray -Force
          }
          Save-Config $cfg
          $after = ($registryArray | ForEach-Object { ([string]$_.username) + ':' + ([string]$_.role) }) -join ', '
          Add-Audit -User $actor -Action 'Config_UserRegistry_Update' -ProjectId '' -ObjType 'Config' -ObjId 'user_registry' -From $before -To $after -Detail ''
          # v12: someone taken off the roster loses their password file and any
          # open session with it, so the name cannot sign in again if it is
          # ever re-added without the admin issuing a new password.
          $script:RegistryCache = @{ sig = ''; list = @() }
          $keepFiles = @{}
          foreach ($u in $registryArray) { $keepFiles[(Split-Path -Leaf (Get-AuthFile ([string]$u.username)))] = $true }
          if (Test-Path -LiteralPath $AuthDir) {
            foreach ($af in @(Get-ChildItem -LiteralPath $AuthDir -Filter 'u_*.json' -File -ErrorAction SilentlyContinue)) {
              if ($keepFiles.ContainsKey($af.Name)) { continue }
              try {
                $gone = Read-JsonFile $af.FullName
                Remove-Item -LiteralPath $af.FullName -Force
                if ($gone -and $gone.username) { Remove-UserSessions -Username ([string]$gone.username) }
              } catch { Write-Log ('Could not remove ' + $af.Name + ': ' + $_.Exception.Message) 'WARN' }
            }
          }
          New-JsonResponse -Response $res -StatusCode 200 -Body @{ ok = $true; user_registry = $registryArray }
        }
      }
      elseif ($method -eq 'POST' -and $path -eq '/api/config/folder-structure') {
        # v12: the admin fixes the folder levels every upload to the common
        # vault is filed under. Applies to files uploaded from now on; nothing
        # already in the vault is moved (stored paths stay valid either way).
        # The PIN endpoints that used to sit here (verify-pin / change-pin)
        # went with the PIN itself - see "v12 auth".
        $body = Read-JsonBody -Request $req
        $actor = [string]$body.user
        if ($actor.ToLowerInvariant() -ne 'admin') {
          New-JsonResponse -Response $res -StatusCode 403 -Body @{ error = 'Only the admin user can change the folder structure.' }
        } else {
          $levels = @(ConvertTo-List $body.levels | ForEach-Object { ([string]$_).Trim() } | Where-Object { $_ })
          $errs = @(Test-EvidenceLevels $levels)
          if ($errs.Count) {
            New-JsonResponse -Response $res -StatusCode 400 -Body @{ error = ($errs -join ' '); errors = $errs }
          } else {
            $cfg = Get-Config
            $before = (Get-EvidenceLevels $cfg) -join '\'
            $cfg.deployment_defaults | Add-Member -NotePropertyName evidence_folder_levels -NotePropertyValue $levels -Force
            $cfg.deployment_defaults | Add-Member -NotePropertyName evidence_folder_pattern -NotePropertyValue ($levels -join '\') -Force
            Save-Config $cfg
            Add-Audit -User $actor -Action 'Config_FolderStructure_Update' -ProjectId '' -ObjType 'Config' -ObjId 'evidence_folder_levels' -From $before -To ($levels -join '\') -Detail 'Applies to new uploads'
            New-JsonResponse -Response $res -StatusCode 200 -Body @{ ok = $true; levels = $levels }
          }
        }
      }
      elseif ($method -eq 'POST' -and $path -eq '/api/config/vault') {
        # Only changes the CONFIGURED folder name/location for FUTURE server
        # starts — does not move existing evidence and does not take effect
        # until the app is restarted (see the "document vault (v2.1)" block
        # near the top of this file, which resolves the vault once at launch).
        $body = Read-JsonBody -Request $req
        $actor = [string]$body.user
        if ($actor.ToLowerInvariant() -ne 'admin') {
          New-JsonResponse -Response $res -StatusCode 403 -Body @{ error = 'Only the admin user can change the evidence vault location.' }
        } else {
          $folderName = ([string]$body.evidence_vault_folder_name).Trim()
          $relative   = ([string]$body.evidence_vault_relative_to_root).Trim()
          if (-not $folderName) { $folderName = 'NPI_EPM_Documents_Control' }
          if (-not $relative)   { $relative = '..' }
          # v11.1: the vault MUST stay under the same site as the app - a
          # SharePoint library synced by OneDrive to every PC, per the v11
          # storage design (see Test-StorageHealth and $JournalRoot above).
          # A vault pointed outside that tree exists on only ONE PC, which
          # silently breaks every other PC's uploads/history the moment they
          # save evidence nobody else's copy can see. Nothing enforced this
          # before v11.1 - the field just accepted arbitrary text.
          $siteRoot = [System.IO.Path]::GetFullPath((Split-Path -Parent $RootDir))
          $resolved = ''
          try { $resolved = [System.IO.Path]::GetFullPath((Join-Path (Join-Path $RootDir $relative) $folderName)) } catch { }
          if (-not $resolved -or -not $resolved.StartsWith($siteRoot, [StringComparison]::OrdinalIgnoreCase)) {
            New-JsonResponse -Response $res -StatusCode 400 -Body @{
              error = "The vault location must stay under the same site as the app ($siteRoot) - it is deployed as one shared app folder synced to every PC, and a vault outside that tree would only exist on this one machine."
            }
          } else {
          $cfg = Get-Config
          $beforeFolder = [string]$cfg.deployment_defaults.evidence_vault_folder_name
          $beforeRelative = [string]$cfg.deployment_defaults.evidence_vault_relative_to_root
          $cfg.deployment_defaults.evidence_vault_folder_name = $folderName
          $cfg.deployment_defaults.evidence_vault_relative_to_root = $relative
          # Clear the resolved path/root so the startup block in this file
          # recomputes a fresh default from the new folder name/relative path
          # next time the server launches, instead of reusing the old resolved
          # location (which the self-healing check would otherwise keep, since
          # its parent folder still exists).
          $cfg.deployment_defaults | Add-Member -NotePropertyName evidence_vault_path -NotePropertyValue '' -Force
          $cfg.deployment_defaults | Add-Member -NotePropertyName evidence_vault_root -NotePropertyValue '' -Force
          Save-Config $cfg
          Add-Audit -User $actor -Action 'Config_Vault_Update' -ProjectId '' -ObjType 'Config' -ObjId 'evidence_vault' -From ($beforeFolder + ' @ ' + $beforeRelative) -To ($folderName + ' @ ' + $relative) -Detail 'Takes effect on next server restart'
          New-JsonResponse -Response $res -StatusCode 200 -Body @{ ok = $true; evidence_vault_folder_name = $folderName; evidence_vault_relative_to_root = $relative }
          }
        }
      }
      elseif ($method -eq 'GET' -and $path -eq '/api/browse-folders') {
        # v11.1: a real folder browser for Settings -> Evidence vault
        # location, instead of typing a folder name and a relative path
        # blind. Deliberately fenced to the "site" - the app root's own
        # parent folder - the same boundary /api/config/vault now enforces,
        # so nothing reachable here can end up producing a vault path that
        # would break every other PC's sync. ?path= is relative to that site
        # root; missing or outside it snaps back to the root itself.
        $siteRoot = [System.IO.Path]::GetFullPath((Split-Path -Parent $RootDir))
        $reqPath = (Get-QueryValue -Request $req -Name 'path')
        $target = $siteRoot
        if ($reqPath) {
          try { $target = [System.IO.Path]::GetFullPath((Join-Path $siteRoot $reqPath)) } catch { $target = $siteRoot }
          if (-not $target.StartsWith($siteRoot, [StringComparison]::OrdinalIgnoreCase)) { $target = $siteRoot }
        }
        $folders = @()
        $errMsg = ''
        try {
          $folders = @(Get-ChildItem -LiteralPath $target -Directory -ErrorAction Stop |
            Where-Object { $_.Name -ne 'journal' -and $_.Name -notlike '.*' } |
            Sort-Object Name | ForEach-Object { $_.Name })
        } catch { $errMsg = $_.Exception.Message }
        $rel = $target.Substring($siteRoot.Length).TrimStart('\')
        New-JsonResponse -Response $res -StatusCode 200 -Body @{
          site_root = $siteRoot; path = $rel; folders = $folders
          can_go_up = [bool]$rel; error = $errMsg
        }
      }
      elseif ($method -eq 'POST' -and $path -eq '/api/config/issue-headers') {
        $body = Read-JsonBody -Request $req
        $cfg = Get-Config
        # [ordered], not ConvertTo-Hashtable's plain @{} — the family/doctype
        # list routes use that helper because array order doesn't matter there,
        # but this map's key order IS the CSV column order for the template and
        # export, and a plain hashtable does not survive a JSON round trip with
        # its insertion order intact. $body.headers is itself already ordered
        # (Read-JsonBody -> ConvertFrom-Json preserves source order), so just
        # walk its properties in that order.
        $ordered = [ordered]@{}
        foreach ($p in $body.headers.PSObject.Properties) { $ordered[$p.Name] = [string]$p.Value }
        $cfg.issue_tracker_headers = $ordered
        Save-Config $cfg
        Add-Audit -User $body.user -Action 'Config_IssueHeaders_Update' -ProjectId '' -ObjType 'Config' -ObjId 'issue_tracker_headers' -From '' -To '' -Detail ($body | ConvertTo-Json -Compress)
        New-JsonResponse -Response $res -StatusCode 200 -Body @{ ok = $true; issue_tracker_headers = $cfg.issue_tracker_headers }
      }
      elseif ($method -eq 'POST' -and $path -eq '/api/config/changetypes') {
        $body = Read-JsonBody -Request $req
        $cfg = Get-Config
        $incoming = @($body.change_types)
        $errors = @()

        # Build step-id sets for validation
        $npiStepIds = @{}
        foreach ($s in @($cfg.npi_workflow.steps)) { $npiStepIds[( [int]$s.step_id)] = $true }
        $ecnStepIds = @{}
        foreach ($s in @($cfg.ecn_workflow.steps)) { $ecnStepIds[( [int]$s.step_id)] = $true }

        # Validate
        $seenTypes = @{}
        for ($i = 0; $i -lt $incoming.Count; $i++) {
          $t = $incoming[$i]
          $tid = [string]$t.type_id
          if (-not $tid) { $errors += @{ index = $i; field = 'type_id'; msg = 'type_id is required' }; continue }
          if ($seenTypes.ContainsKey($tid.ToUpperInvariant())) {
            $errors += @{ index = $i; field = 'type_id'; msg = ("type_id '" + $tid + "' appears more than once") }; continue
          }
          $seenTypes[$tid.ToUpperInvariant()] = $true

          # cycle_time_days: must be null or a non-negative integer
          $ct = $t.cycle_time_days
          if ($null -ne $ct) {
            $ctVal = $null
            if (-not [int]::TryParse([string]$ct, [ref]$ctVal) -or $ctVal -lt 0) {
              $errors += @{ index = $i; field = 'cycle_time_days'; msg = ("cycle_time_days must be a non-negative integer or null (got '" + [string]$ct + "')") }
            }
          }

          # Validate npi_steps
          foreach ($sid in @($t.npi_steps)) {
            if (-not $npiStepIds.ContainsKey([int]$sid)) {
              $errors += @{ index = $i; field = 'npi_steps'; msg = ("step " + [string]$sid + " does not exist in the NPI workflow") }
            }
          }

          # v11 R4: steps_by_process.<process_id> = [step ids] for any pillar
          if ($t.steps_by_process) {
            foreach ($prop in $t.steps_by_process.PSObject.Properties) {
              $pdef = Get-ProcessDef -Config $cfg -ProcessId $prop.Name
              if (-not $pdef) { $errors += @{ index = $i; field = 'steps_by_process'; msg = ("'" + $prop.Name + "' is not a configured pillar") }; continue }
              $ids = @{}; foreach ($s in @($pdef.steps)) { $ids[[string]$s.step_id] = $true }
              foreach ($sid in @($prop.Value)) {
                if (-not $ids.ContainsKey([string]$sid)) { $errors += @{ index = $i; field = 'steps_by_process'; msg = ("step " + [string]$sid + " does not exist in the " + $prop.Name + " workflow") } }
              }
            }
          }
          # Validate ecn_steps
          foreach ($sid in @($t.ecn_steps)) {
            if (-not $ecnStepIds.ContainsKey([int]$sid)) {
              $errors += @{ index = $i; field = 'ecn_steps'; msg = ("step " + [string]$sid + " does not exist in the ECN workflow") }
            }
          }
        }

        if ($errors.Count -gt 0) {
          New-JsonResponse -Response $res -StatusCode 400 -Body @{
            error = 'Validation failed'; validation_errors = @($errors)
          }
        } else {
        # v2.7 — guard against deleting a change type still referenced by projects
        $currentTypeIds = @(@($cfg.change_types) | ForEach-Object { [string]$_.type_id })
        $incomingTypeIds = @(@($incoming) | ForEach-Object { [string]$_.type_id })
        $removedTypeIds = @($currentTypeIds | Where-Object { $_ -notin $incomingTypeIds })
        if ($removedTypeIds.Count -gt 0) {
          $allProjects = @(Read-Store 'lb_projects')
          $conflictMsgs = @()
          foreach ($tid in $removedTypeIds) {
            $refs = @($allProjects | Where-Object { [string]$_.class_abcde -eq $tid })
            if ($refs.Count -gt 0) {
              $refList = ($refs | ForEach-Object { $_.project_id }) -join ', '
              $conflictMsgs += ("Cannot delete change type '" + $tid + "' — it is still referenced by project(s): " + $refList)
            }
          }
          if ($conflictMsgs.Count -gt 0) {
            New-JsonResponse -Response $res -StatusCode 409 -Body @{
              error = ($conflictMsgs -join '; ')
            }
          } else {
            $cfg.change_types = $incoming
            Save-Config $cfg
            Add-Audit -User $body.user -Action 'Config_ChangeTypes_Update' -ProjectId '' -ObjType 'Config' -ObjId 'change_types' -From '' -To '' -Detail ($incoming.Count.ToString() + ' type(s) saved')
            New-JsonResponse -Response $res -StatusCode 200 -Body @{ ok = $true; change_types = $cfg.change_types }
          }
        } else {
          $cfg.change_types = $incoming
          Save-Config $cfg
          Add-Audit -User $body.user -Action 'Config_ChangeTypes_Update' -ProjectId '' -ObjType 'Config' -ObjId 'change_types' -From '' -To '' -Detail ($incoming.Count.ToString() + ' type(s) saved')
          New-JsonResponse -Response $res -StatusCode 200 -Body @{ ok = $true; change_types = $cfg.change_types }
        }
        }   # end else (valid)
      }
      elseif ($method -eq 'POST' -and $path -eq '/api/projects') {
        $body = Read-JsonBody -Request $req
        $now = (Get-Date).ToUniversalTime().ToString('o')
        # v2.1 ID format: [NPI|ECN]-[Family], e.g. NPI-9649LP, ECN-5612.
        # Whatever the user typed as the family (specific model code) IS the
        # readable half. v3.6 renamed the wire field from family_id to family
        # to match the corrected schema — this IS the project's Family.
        $famId = ([string]$body.family).Trim()
        if (-not $famId) { throw 'A Family is required — it forms the project ID.' }
        $idPart = ($famId.ToUpperInvariant() -replace '[^A-Z0-9\.\-_]', '')
        if (-not $idPart) { throw "Family '$famId' has no usable characters for an ID." }
        # v11 R4: the process must be a configured pillar; the ID is
        # <process_id>-<family> for every pillar.
        if (-not (Get-ProcessDef -Config (Get-Config) -ProcessId ([string]$body.process))) {
          throw ("Unknown process '" + [string]$body.process + "' - it must be one of the configured pillars (" + (((Get-ProcessDefs (Get-Config)) | ForEach-Object { $_.process_id }) -join ', ') + ").")
        }
        $candidate = ([string]$body.process) + '-' + $idPart

        # certifications arrive as an array from the browser; store them flat
        $certs = ''
        if ($body.certifications) { $certs = (@($body.certifications) | Where-Object { $_ }) -join '|' }

        # Target date: honour a manual override, otherwise compute from the
        # configured cycle-time baselines server-side so the stored date is
        # always authoritative regardless of what the browser sends.
        $target_date = ([string]$body.target_date).Trim()
        if (-not $target_date) {
          $target_date = Get-TargetDate -ClassAbcde $body.class_abcde `
                                        -Identifier @($body.prod_family, $famId) `
                                        -PrfDate $body.prf_date -Config (Get-Config)
        }

        $row = @{
          process = $body.process; prod_family = $body.prod_family; family = $famId
          class_abcde = $body.class_abcde; target_date = $target_date; certifications = $certs
          prf_date = $body.prf_date; market_manager = $body.market_manager; country = $body.country
          customer_number = $body.customer_number; status = 'Active'; created_by = $body.created_by
          created_utc = $now; updated_utc = $now; notes = $body.notes
        }
        $saved = Add-StoreRow -Store 'lb_projects' -IdField 'project_id' -IdCandidate $candidate -Row $row
        Add-Audit -User $body.created_by -Action 'Create_Project' -ProjectId $saved.project_id -ObjType 'Project' -ObjId $saved.project_id -From '' -To 'Active' -Detail ('Type ' + $body.class_abcde + ' · target ' + $target_date)
        New-JsonResponse -Response $res -StatusCode 200 -Body $saved
      }
      elseif ($method -eq 'POST' -and $path -eq '/api/projects/batch') {
        # Batch project registration (v3.1). Same field semantics and the same
        # project-ID rule as POST /api/projects, but every row is validated up
        # front and the accepted set is written in ONE locked transaction.
        #
        # Deliberately stricter than the single-project route in one respect:
        # when a candidate ID already exists, the single route quietly appends
        # -2/-3 to make it unique. In a bulk import that silently manufactures
        # NPI-9649LP-2 from what is almost always a duplicated spreadsheet row,
        # so here it is a rejection instead. Uniqueness suffixing still exists
        # in Add-StoreRowsBatch purely as a last-resort race guard.
        $body = Read-JsonBody -Request $req
        $cfg = Get-Config
        $csvText = [string]$body.csv
        # v3.6: 'family' is now the specific model code that forms the project
        # ID (e.g. 9649LP), and 'prod_family' is the broad category (e.g.
        # CL-CORDLESS) — the old header had these backwards under the names
        # 'family_id' and 'family' respectively.
        $EXPECTED = @('process','family','class_abcde','prod_family','prf_date',
                      'target_date','market_manager','country','customer_number','notes','certifications')

        $records = ConvertFrom-CsvText $csvText

        # Validation failures are collected into $fatal and answered in the else
        # branch below. They must NOT use `return`: this handler runs at script
        # scope inside the request loop, where `return` exits the entire script -
        # it runs the outer finally, stops the listener and kills the server.
        # An early-exit here would mean "upload a CSV with a missing column" is
        # a remote shutdown.
        $fatal = $null
        $header = @(); $idx = @{}
        if ($records.Count -lt 1) {
          $fatal = 'The CSV is empty.'
        } else {
          $headerCells = $records[0]
          foreach ($h in $headerCells) { $header += ([string]$h).Trim().ToLowerInvariant() }
          $missing = @($EXPECTED | Where-Object { $header -notcontains $_ })
          if ($missing.Count) {
            $fatal = ('The CSV is missing required column(s): ' + ($missing -join ', ') +
                      '. Use the Download CSV Template button to get the correct header row.')
          }
        }
        if ($fatal) {
          New-JsonResponse -Response $res -StatusCode 400 -Body @{ error = $fatal }
        } else {
        for ($h = 0; $h -lt $header.Count; $h++) { if (-not $idx.ContainsKey($header[$h])) { $idx[$header[$h]] = $h } }

        # --- lookups for validation -------------------------------------------
        $validClasses = @{}
        foreach ($t in @($cfg.change_types)) { $validClasses[([string]$t.type_id).ToUpperInvariant()] = $t }
        $famById = @{}; $famByName = @{}
        foreach ($f in @($cfg.prod_families)) {
          $famById[([string]$f.prod_family_id).ToUpperInvariant()] = $f
          $famByName[([string]$f.prod_family_name).Trim().ToLowerInvariant()] = $f
        }
        $existingIds = @{}
        foreach ($p in @(Read-Store 'lb_projects')) { $existingIds[([string]$p.project_id).ToUpperInvariant()] = $true }

        $now = (Get-Date).ToUniversalTime().ToString('o')
        # Plain arrays, NOT List[object]: wrapping a List[object] of hashtables
        # in @() yields a collection ConvertTo-Json cannot serialise under PS
        # 5.1 - it throws "Argument types do not match" mid-response, after the
        # rows have already been written. /api/issues/import uses plain arrays
        # for the same reason; match it.
        $accepted = @()
        $idCandidates = @{}
        $seenInFile = @{}
        $rejections = @()
        $total = 0

        for ($r = 1; $r -lt $records.Count; $r++) {
          $cells = $records[$r]
          $get = {
            param($name)
            $k = $idx[$name]
            if ($null -eq $k -or $k -ge $cells.Count) { return '' }
            return ([string]$cells[$k]).Trim()
          }
          # A row whose every cell is blank is spreadsheet padding, not an error.
          $anyContent = $false
          foreach ($cc in $cells) { if (([string]$cc).Trim() -ne '') { $anyContent = $true; break } }
          if (-not $anyContent) { continue }
          # Template sample rows are commented out with a leading '#'. Skipping
          # them here is what stops "download template, add a row, upload" from
          # silently registering the example as a real project.
          if ((& $get 'process').StartsWith('#')) { continue }

          $total++
          $rowNo = $r + 1          # 1-based including the header, so it matches Excel

          $process = (& $get 'process').ToUpperInvariant()
          $familyId = & $get 'family'
          $klass    = (& $get 'class_abcde').ToUpperInvariant()
          $famRaw   = & $get 'prod_family'

          if (-not (Get-ProcessDef -Config $cfg -ProcessId $process)) {
            $rejections += @{ row = $rowNo; reason = ("process must be one of the configured pillars (" + (((Get-ProcessDefs $cfg) | ForEach-Object { $_.process_id }) -join ', ') + "), got '" + (& $get 'process') + "'") }; continue
          }
          if (-not $klass) {
            $rejections += @{ row = $rowNo; reason = 'class_abcde is required' }; continue
          }
          if (-not $validClasses.ContainsKey($klass)) {
            $rejections += @{ row = $rowNo; reason = ("class_abcde '" + $klass + "' is not a configured change type (" +
              ((@($cfg.change_types) | ForEach-Object { $_.type_id }) -join '/') + ")") }; continue
          }
          # family (the specific model code) forms the project ID.
          $idSeed = $familyId
          if (-not $idSeed) {
            $rejections += @{ row = $rowNo; reason = 'family is required - it forms the project ID' }; continue
          }
          $idPart = ($idSeed.ToUpperInvariant() -replace '[^A-Z0-9\.\-_]', '')
          if (-not $idPart) {
            $rejections += @{ row = $rowNo; reason = ("family '" + $idSeed + "' has no characters usable in an ID") }; continue
          }
          $candidate = $process + '-' + $idPart

          # prod_family is optional, but a value that matches nothing
          # configured is almost always a typo, so it is surfaced rather than
          # stored as-is.
          $familyResolved = ''
          if ($famRaw) {
            $hit = $null
            if ($famById.ContainsKey($famRaw.ToUpperInvariant())) { $hit = $famById[$famRaw.ToUpperInvariant()] }
            elseif ($famByName.ContainsKey($famRaw.ToLowerInvariant())) { $hit = $famByName[$famRaw.ToLowerInvariant()] }
            else {
              # tolerate the UI's own "Category Name (PROD_FAMILY_ID)" display form
              $m = [regex]::Match($famRaw, '\(([^)]+)\)\s*$')
              if ($m.Success -and $famById.ContainsKey($m.Groups[1].Value.Trim().ToUpperInvariant())) {
                $hit = $famById[$m.Groups[1].Value.Trim().ToUpperInvariant()]
              }
            }
            if (-not $hit) {
              $rejections += @{ row = $rowNo; reason = ("prod_family '" + $famRaw + "' is not a configured product family") }; continue
            }
            $familyResolved = [string]$hit.prod_family_id
          }

          # Dates accept an ISO week (YYYY-Www, the v3.0 planning format) or a
          # calendar date (YYYY-MM-DD, what a legacy sheet holds). Blank is fine.
          $badDate = $null
          foreach ($dcol in @('prf_date','target_date')) {
            $dv = & $get $dcol
            if (-not $dv) { continue }
            if ($dv -notmatch '^\d{4}-W\d{2}$' -and $dv -notmatch '^\d{4}-\d{2}-\d{2}$') {
              $badDate = ($dcol + " '" + $dv + "' must be an ISO week (2026-W32) or a date (2026-08-06)"); break
            }
            if ($dv -match '^\d{4}-W(\d{2})$' -and ([int]$Matches[1] -lt 1 -or [int]$Matches[1] -gt 53)) {
              $badDate = ($dcol + " '" + $dv + "' has a week number outside 01-53"); break
            }
            if ($dv -match '^\d{4}-\d{2}-\d{2}$') {
              $parsed = [datetime]::MinValue
              if (-not [datetime]::TryParseExact($dv, 'yyyy-MM-dd', [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::None, [ref]$parsed)) {
                $badDate = ($dcol + " '" + $dv + "' is not a real calendar date"); break
              }
            }
          }
          if ($badDate) { $rejections += @{ row = $rowNo; reason = $badDate }; continue }

          if ($seenInFile.ContainsKey($candidate.ToUpperInvariant())) {
            $rejections += @{ row = $rowNo; reason = ("duplicate of row " + $seenInFile[$candidate.ToUpperInvariant()] +
              " in this file - both produce project ID " + $candidate) }; continue
          }
          if ($existingIds.ContainsKey($candidate.ToUpperInvariant())) {
            $rejections += @{ row = $rowNo; reason = ("project " + $candidate + " already exists - existing projects are never overwritten by an import") }; continue
          }
          $seenInFile[$candidate.ToUpperInvariant()] = $rowNo

          $targetDate = & $get 'target_date'
          if (-not $targetDate) {
            $targetDate = Get-TargetDate -ClassAbcde $klass -Identifier @($familyResolved, $idSeed) `
                                         -PrfDate (& $get 'prf_date') -Config $cfg
          }
          $certs = ((& $get 'certifications') -split '[|;]' | ForEach-Object { $_.Trim() } | Where-Object { $_ }) -join '|'

          $key = [string]$rowNo
          $idCandidates[$key] = $candidate
          $accepted += @{
            __key = $key
            process = $process; prod_family = $familyResolved; family = $familyId
            class_abcde = $klass; target_date = $targetDate; certifications = $certs
            prf_date = (& $get 'prf_date'); market_manager = (& $get 'market_manager')
            country = (& $get 'country'); customer_number = (& $get 'customer_number')
            status = 'Active'; created_by = ([string]$body.user)
            created_utc = $now; updated_utc = $now; notes = (& $get 'notes')
          }
        }

        # --- single locked write for the whole accepted set --------------------
        $createdIds = @()
        if ($accepted.Count) {
          $createdIds = @(Add-StoreRowsBatch -Store 'lb_projects' -Rows $accepted `
                                             -IdField 'project_id' -IdCandidates $idCandidates)
          foreach ($newId in $createdIds) {
            try {
              Add-Audit -User $body.user -Action 'Create_Project_Batch' -ProjectId $newId `
                        -ObjType 'Project' -ObjId $newId -From '' -To 'Active' -Detail 'Batch CSV import'
            } catch { }
          }
        }
        Add-Audit -User $body.user -Action 'Import_Projects_Batch' -ProjectId '' -ObjType 'Project' -ObjId '' `
                  -From '' -To '' -Detail ("$($accepted.Count) accepted, $($rejections.Count) rejected of $total row(s)")
        Write-Log ("Batch project import: $($accepted.Count) accepted, $($rejections.Count) rejected of $total row(s)")

        New-JsonResponse -Response $res -StatusCode 200 -Body @{
          ok = $true; total = $total; accepted = $accepted.Count; rejected = $rejections.Count
          created_project_ids = $createdIds; rejections = @($rejections)
        }
        }   # end else (header validation passed)
      }
      elseif ($method -eq 'GET' -and $path -eq '/api/templates') {
        $files = @()
        if (Test-Path -LiteralPath $TemplatesDir) {
          $files = @(Get-ChildItem -LiteralPath $TemplatesDir -File |
            Where-Object { $_.Name -notlike '.*' -and $_.Name -notlike '_*' -and $_.Name -notlike '~$*' } |
            ForEach-Object { @{ name = $_.Name; bytes = $_.Length; modified = $_.LastWriteTime.ToString('yyyy-MM-dd') } })
        }
        New-JsonResponse -Response $res -StatusCode 200 -Body @{ templates = $files }
      }
      elseif ($method -eq 'GET' -and $path -like '/api/templates/*') {
        # Serve only a plain file name out of system\templates — no directory
        # component ever reaches the filesystem, so ..\..\ cannot escape.
        $raw  = [System.Uri]::UnescapeDataString($path.Substring('/api/templates/'.Length))
        $name = [System.IO.Path]::GetFileName($raw)
        $file = Join-Path $TemplatesDir $name
        $full = [System.IO.Path]::GetFullPath($file)
        if (-not $name -or -not $full.StartsWith([System.IO.Path]::GetFullPath($TemplatesDir), [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $full -PathType Leaf)) {
          New-JsonResponse -Response $res -StatusCode 404 -Body @{ error = "template '$name' not found" }
        } else {
          $bytes = [System.IO.File]::ReadAllBytes($full)
          $res.StatusCode = 200
          $res.ContentType = 'application/octet-stream'
          $res.AddHeader('Content-Disposition', 'attachment; filename="' + $name + '"')
          $res.ContentLength64 = $bytes.Length
          $res.OutputStream.Write($bytes, 0, $bytes.Length)
          $res.OutputStream.Close()
          Write-Log ('Template downloaded: ' + $name)
        }
      }
      elseif ($method -eq 'GET' -and $path -like '/api/vault/view/*') {
        # Streams a filed evidence document back to the browser for inline
        # preview (image thumbnail, PDF/Office file card) - v4.0.
        #
        # Unlike /api/templates/*, evidence genuinely lives in a nested
        # [Family]\[DocType]\[file] structure under $EvidenceDir, so the
        # request carries a whole relative path, not a bare file name - a
        # GetFileName() flatten (the templates route's trick) would break
        # every real evidence path. Safety instead comes entirely from
        # canonicalizing the combined path and checking it still starts with
        # $EvidenceDir's own canonical form: a crafted "..\..\windows\..."
        # segment resolves outside the vault and gets rejected here exactly
        # like it would for the templates route, no matter how deep the
        # legitimate nesting goes.
        #
        # Content-Type is drawn from a fixed allowlist keyed on extension,
        # defaulting to application/octet-stream for anything unrecognised -
        # this is deliberate: serving an uploaded file back as text/html (or
        # letting the browser sniff it into one) would let a maliciously
        # crafted "evidence" file execute as script in this origin the
        # moment someone previews it. An unknown type downloads instead of
        # rendering; it never gets a free pass to be treated as markup.
        $raw = [System.Uri]::UnescapeDataString($path.Substring('/api/vault/view/'.Length))
        $relPath = $raw -replace '/', '\'
        $file = Join-Path $EvidenceDir $relPath
        $full = [System.IO.Path]::GetFullPath($file)
        $vaultFull = [System.IO.Path]::GetFullPath($EvidenceDir)
        # v12.2: <vault>\_vault holds the project data (journals, settings), not evidence
        $inDataDir = $full.StartsWith($vaultFull.TrimEnd('\') + '\_vault\', [StringComparison]::OrdinalIgnoreCase)
        if (-not $relPath -or $inDataDir -or -not $full.StartsWith($vaultFull, [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $full -PathType Leaf)) {
          New-JsonResponse -Response $res -StatusCode 404 -Body @{ error = 'evidence file not found' }
        } else {
          $viewExt = [System.IO.Path]::GetExtension($full).ToLowerInvariant()
          $viewType = switch ($viewExt) {
            '.png'  { 'image/png' }
            '.jpg'  { 'image/jpeg' }
            '.jpeg' { 'image/jpeg' }
            '.webp' { 'image/webp' }
            '.gif'  { 'image/gif' }
            '.pdf'  { 'application/pdf' }
            '.txt'  { 'text/plain; charset=utf-8' }
            '.csv'  { 'text/plain; charset=utf-8' }
            default { 'application/octet-stream' }
          }
          $bytes = [System.IO.File]::ReadAllBytes($full)
          $res.StatusCode = 200
          $res.ContentType = $viewType
          # inline, not attachment: the point is an in-tab preview, and only
          # the allowlisted types above are ever eligible to render as
          # anything other than a download prompt anyway.
          $res.AddHeader('Content-Disposition', 'inline; filename="' + [System.IO.Path]::GetFileName($full) + '"')
          $res.Headers.Add('Cache-Control', 'no-store')
          $res.ContentLength64 = $bytes.Length
          $res.OutputStream.Write($bytes, 0, $bytes.Length)
          $res.OutputStream.Close()
        }
      }
      elseif ($method -eq 'POST' -and $path -eq '/api/templates/upload') {
        $body = Read-JsonBody -Request $req
        $fileName = [string]$body.fileName
        $contentBase64 = [string]$body.contentBase64
        $user = [string]$body.user
        $overwrite = [bool]$body.overwrite

        # ---- extension validation --------------------------------------------------
        $ext = [System.IO.Path]::GetExtension($fileName).ToLowerInvariant()
        if ($ext -notin @('.xlsx','.docx','.pdf')) {
          New-JsonResponse -Response $res -StatusCode 400 -Body @{
            error = ("File extension '" + $ext + "' is not accepted. Only .xlsx, .docx and .pdf files are allowed.")
          }
        } else {
        # ---- sanitise filename: strip any directory component, reject path traversal --
        $safeName = [System.IO.Path]::GetFileName($fileName)
        if (-not $safeName -or $safeName -ne $fileName) {
          New-JsonResponse -Response $res -StatusCode 400 -Body @{
            error = 'The filename contains directory components. Provide only a plain file name — no folders, no slashes, no drive letters.'
          }
        } elseif ($safeName -eq '.' -or $safeName -eq '..') {
          New-JsonResponse -Response $res -StatusCode 400 -Body @{
            error = 'The filename is not valid.'
          }
        } elseif ($safeName -match '^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.[^.]+)?$') {
          New-JsonResponse -Response $res -StatusCode 400 -Body @{
            error = 'This file name is reserved and cannot be used.'
          }
        } else {
        # ---- canonical containment -------------------------------------------------
        $destPath = Join-Path $TemplatesDir $safeName
        $full = [System.IO.Path]::GetFullPath($destPath)
        $rootFull = [System.IO.Path]::GetFullPath($TemplatesDir)
        if (-not $full.StartsWith($rootFull, [StringComparison]::OrdinalIgnoreCase)) {
          New-JsonResponse -Response $res -StatusCode 400 -Body @{
            error = 'The filename resolves outside the templates directory.'
          }
        } else {
        # ---- collision check -------------------------------------------------------
        if ((Test-Path -LiteralPath $destPath -PathType Leaf) -and -not $overwrite) {
          New-JsonResponse -Response $res -StatusCode 409 -Body @{
            error = ("Template '" + $safeName + "' already exists. Set overwrite to true to replace it.")
          }
        } else {
        # ---- decode and save -------------------------------------------------------
        try {
          $bytes = [Convert]::FromBase64String($contentBase64)
          [System.IO.File]::WriteAllBytes($destPath, $bytes)
          Add-Audit -User $user -Action 'Upload_Template' -ProjectId '' -ObjType 'Template' -ObjId $safeName -From '' -To '' -Detail ('Size: ' + $bytes.Length + ' bytes, overwrite: ' + $overwrite)
          Write-Log ('Template uploaded: ' + $safeName)
          New-JsonResponse -Response $res -StatusCode 200 -Body @{
            ok = $true; fileName = $safeName; bytes = $bytes.Length
          }
        } catch {
          Write-Log ('Template upload failed: ' + $_.Exception.Message) 'ERROR'
          New-JsonResponse -Response $res -StatusCode 500 -Body @{
            error = ('Could not save the uploaded file: ' + $_.Exception.Message)
          }
        }
        }   # end else (no collision or overwrite)
        }   # end else (containment)
        }   # end else (safe filename)
        }   # end else (valid extension)
      }
      elseif ($method -eq 'GET' -and $path -eq '/api/issues/template.csv') {
        $cfg = Get-Config
        $labels = @($cfg.issue_tracker_headers.PSObject.Properties.Value)
        $cells = foreach ($lbl in $labels) { ConvertTo-CsvCell ([string]$lbl) }
        $csv = ($cells -join ',') + "`r`n"
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($csv)
        $res.StatusCode = 200
        $res.ContentType = 'text/csv; charset=utf-8'
        $res.AddHeader('Content-Disposition', 'attachment; filename="issue_tracker_template.csv"')
        $res.ContentLength64 = $bytes.Length
        $res.OutputStream.Write($bytes, 0, $bytes.Length)
        $res.OutputStream.Close()
      }
      elseif ($method -eq 'POST' -and $path -eq '/api/issues/import') {
        $body = Read-JsonBody -Request $req
        $cfg = Get-Config
        # Build reverse map: lowercased trimmed display label -> internal field name.
        # Also accept bare internal field names directly (e.g. "sp_id" from a
        # Power Apps export that adds columns), so they don't get silently dropped.
        $rev = @{}
        foreach ($p in $cfg.issue_tracker_headers.PSObject.Properties) {
          $rev[([string]$p.Value).Trim().ToLowerInvariant()] = $p.Name
        }
        foreach ($storeCol in $Stores['lb_sp_issues']) {
          $rev[$storeCol.ToLowerInvariant()] = $storeCol
        }
        $csvText = [string]$body.csv
        $lines = @($csvText -split "`r?`n" | Where-Object { $_ -ne '' })
        # NOT `return` on the empty case. This handler runs at script scope
        # inside the request loop, so `return` exits the whole script - it runs
        # the outer finally, stops the listener and kills the server. Posting an
        # empty issues CSV was therefore a remote shutdown. Answer 400 and let
        # the if/else fall through to the next request instead.
        if ($lines.Count -lt 1) {
          New-JsonResponse -Response $res -StatusCode 400 -Body @{ error = 'CSV is empty' }
        } else {
        # Header row — resolved column map: index -> internal field name (or $null if unmatched).
        # No @() here: ConvertFrom-CsvLine already returns its List[string] via the
        # comma operator (`return ,$out`) specifically so it comes back directly
        # indexable, not unrolled. Wrapping that in @() a second time doesn't
        # flatten it - it produces a 1-element array whose one element is the
        # WHOLE list, which then string-concatenates via PowerShell's default
        # $OFS-joined collection-to-string conversion. Every other call site in
        # this file (Read-Store, Add-StoreRow, Set-StoreRow) already calls it bare
        # for exactly this reason - match that.
        $headerCells = ConvertFrom-CsvLine $lines[0]
        $colMap = New-Object 'object[]' $headerCells.Count
        for ($ci = 0; $ci -lt $headerCells.Count; $ci++) {
          $key = $headerCells[$ci].Trim().ToLowerInvariant()
          $colMap[$ci] = if ($rev.ContainsKey($key)) { $rev[$key] } else { $null }
        }
        # Read existing projects for validation
        $projects = @(Read-Store 'lb_projects')
        $projSet = @{}
        foreach ($p in $projects) { $projSet[([string]$p.project_id).ToUpperInvariant()] = $true }
        $accepted = 0; $rejected = @()
        for ($li = 1; $li -lt $lines.Count; $li++) {
          $cells = ConvertFrom-CsvLine $lines[$li]
          $row = @{}
          for ($ci = 0; $ci -lt $colMap.Count -and $ci -lt $cells.Count; $ci++) {
            $fld = $colMap[$ci]
            if ($fld) { $row[$fld] = $cells[$ci] }
          }
          # Status/priority defaults are applied ONLY for the always-brand-new
          # branch below (no sp_id, no raised_utc), never here. Set-StoreRow
          # only overwrites a column when $row actually contains that key —
          # defaulting status/priority unconditionally at this point would mean
          # every re-import of a CSV that happens to omit those columns (a
          # partial Power Apps export, say) forces every matched row's real
          # status back to Open, silently erasing progress. Leaving the key
          # out of $row when the CSV doesn't supply it lets Set-StoreRow's own
          # per-column merge do the right thing: preserve the existing value on
          # an update, or fall back to '' on a genuinely new row via that path.
          # Validate project_id. Named $rowProjId, not $pid - PowerShell variable
          # names are case-insensitive, so $pid IS $PID, the read-only automatic
          # variable holding the process ID, and assigning to it throws "Cannot
          # overwrite variable PID because it is read-only or constant."
          $rowProjId = ([string]$row['project_id']).Trim()
          if (-not $rowProjId) {
            $rejected += @{ row = ($li + 1); reason = "ProjectID is blank" }
            continue
          }
          if (-not $projSet.ContainsKey($rowProjId.ToUpperInvariant())) {
            $rejected += @{ row = ($li + 1); reason = "ProjectID '$rowProjId' does not match any registered project" }
            continue
          }
          # Upsert or insert
          $spId = ([string]$row['sp_id']).Trim()
          $raisedUtc = ([string]$row['raised_utc']).Trim()
          if ($spId) {
            # Round-tripped export: match on sp_id
            Set-StoreRow -Store 'lb_sp_issues' -KeyFields @('sp_id') -IdField 'sp_id' -Row $row | Out-Null
          } elseif ($raisedUtc) {
            # Genuinely new row with a timestamp: dedup on natural key
            Set-StoreRow -Store 'lb_sp_issues' -KeyFields @('project_id','title','raised_utc') -IdField 'sp_id' -Row $row | Out-Null
          } else {
            # No sp_id and no timestamp — always brand-new, so defaulting
            # status/priority here is unconditionally safe: there is no
            # existing row this could ever clobber.
            $row['raised_utc'] = (Get-Date).ToUniversalTime().ToString('o')
            if (-not $row['status'] -or [string]$row['status'] -eq '') { $row['status'] = 'Open' }
            if (-not $row['priority'] -or [string]$row['priority'] -eq '') { $row['priority'] = 'Medium' }
            Add-StoreRow -Store 'lb_sp_issues' -IdField 'sp_id' -Row $row | Out-Null
          }
          $accepted++
        }
        $detail = "$accepted accepted"
        if ($rejected.Count) { $detail += ", $($rejected.Count) rejected" }
        Add-Audit -User $body.user -Action 'Import_SP_Issues' -ProjectId '' -ObjType 'SPIssue' -ObjId '' -From '' -To '' -Detail $detail
        New-JsonResponse -Response $res -StatusCode 200 -Body @{ ok = $true; accepted = $accepted; rejected = $rejected }
        }   # end else (CSV not empty)
      }
      elseif ($method -eq 'POST' -and $path -eq '/api/action') {
        $body = Read-JsonBody -Request $req
        $store = [string]$body.store
        if (-not $Stores.Contains($store)) { throw "unknown store '$store'" }
        $rowH = ConvertTo-Hashtable $body.row
        $idField = $Stores[$store][0]
        $saved =
          if ($body.upsertKeys) { Set-StoreRow -Store $store -Row $rowH -KeyFields @($body.upsertKeys) -IdField $idField }
          else { Add-StoreRow -Store $store -Row $rowH -IdField $idField }
        if ($body.audit) {
          $a = ConvertTo-Hashtable $body.audit
          Add-Audit -User $a.user -Action $a.action -ProjectId $a.projectId -ObjType $a.objType -ObjId $a.objId -From $a.from -To $a.to -Detail $a.detail
        }
        New-JsonResponse -Response $res -StatusCode 200 -Body $saved
      }
      elseif ($method -eq 'POST' -and $path -eq '/api/upload') {
        $body = Read-JsonBody -Request $req
        $bytes = [Convert]::FromBase64String([string]$body.contentBase64)
        if ($bytes.Length -gt 25MB) { throw 'File exceeds the 25 MB MVP limit.' }
        $original = [string]$body.fileName
        # v2.2: the server names the file, so the convention holds even when
        # somebody uploads "final FINAL v3 (2).xlsx" from their desktop.
        # v11.1: "keep original name" opts a single upload out of that and
        # only sanitises the name Windows was already given - still
        # content-addressed by Save-Evidence's SHA suffix, so two uploads of
        # the same bytes still dedupe the same way either way.
        $stdName = if ($body.keepOriginalName) { Get-SafeName $original } else {
          Get-StandardFileName -DocType $body.docType -Model $body.family -WvnId $body.wvnId `
            -WnbId $body.wnbId -Description $body.description -OriginalName $original `
            -Category $body.partId -ProjectId $body.projectId -Config (Get-Config)
        }
        # v12: folder levels come from Settings -> Common vault folder
        # structure. [Process] and [Step] need the project, so that is looked
        # up only when the browser sent one.
        $upCfg = Get-Config
        $procId = ''
        if ($body.projectId) {
          $upProj = @(Read-Store 'lb_projects' | Where-Object { $_.project_id -eq [string]$body.projectId }) | Select-Object -First 1
          if ($upProj) { $procId = [string]$upProj.process }
        }
        $levelNames = @(Resolve-EvidenceLevels -Config $upCfg -Values @{
          Model = [string]$body.family; DocType = [string]$body.docType; PartID = [string]$body.partId
          ProjectID = [string]$body.projectId; Process = $procId; Step = [string]$body.stepKey
        })
        $saved = Save-Evidence -DocType $body.docType -Family $body.family -PartId $body.partId -FileName $stdName -Bytes $bytes -LevelNames $levelNames
        $saved | Add-Member -NotePropertyName originalName -NotePropertyValue $original -Force
        New-JsonResponse -Response $res -StatusCode 200 -Body $saved
      }
      elseif ($method -eq 'POST' -and $path -eq '/api/shutdown') {
        # This endpoint kills the process, and the tool has no authentication.
        # Two cheap checks bound who can reach it:
        #   - the caller must be on the loopback interface (Test-LoopbackRequest),
        #     so no other machine can stop this server
        #   - the request must be application/json, which a plain cross-origin
        #     <form> cannot send and which forces a CORS preflight we never answer
        # Neither is real authentication. Anyone at this keyboard can still stop
        # the server deliberately - that is by design, it is their own machine -
        # but a random web page cannot do it by accident.
        #
        # The Origin authority comparison this replaced was the cause of the
        # spurious 403s: it demanded the browser's Origin match $req.Url.Authority
        # exactly, which breaks the moment the launcher falls back from 8080 to
        # 8081/8082. Locality is the property actually worth enforcing.
        $ctype  = [string]$req.ContentType
        $okType = $ctype -and $ctype.ToLowerInvariant().StartsWith('application/json')
        $okLocal = Test-LoopbackRequest -Request $req
        if (-not $okLocal) {
          Write-Log ("Shutdown refused - non-loopback caller " + [string]$req.RemoteEndPoint) 'WARN'
          New-JsonResponse -Response $res -StatusCode 403 -Body @{
            error = 'Shutdown may only be requested from this machine.'
          }
        } elseif (-not $okType) {
          Write-Log ("Shutdown refused - content-type '" + $ctype + "'") 'WARN'
          New-JsonResponse -Response $res -StatusCode 403 -Body @{
            error = 'Shutdown must be an application/json request from this tool.'
          }
        } else {
          $body = Read-JsonBody -Request $req
          $who = [string]$body.user
          Write-Log ('Shutdown requested' + $(if ($who) { ' by ' + $who } else { '' }) + ' — stopping cleanly.')
          try { Add-Audit -User $who -Action 'Stop_Server' -ProjectId '' -ObjType 'Server' -ObjId ("port $boundPort") -From 'Listening' -To 'Stopped' -Detail '' } catch { }
          # Response first, and fully: New-JsonResponse sets ContentLength64,
          # writes, flushes and closes the stream, so the 200 is complete on the
          # wire before anything below runs.
          New-JsonResponse -Response $res -StatusCode 200 -Body @{
            status = 'stopping'; message = 'Server process shutting down cleanly.'
          }
          try { $res.Close() } catch { }

          # Graceful stop, not a forced self-kill. Stop-Process -Id $PID -Force
          # is a much more unusual thing for a process to do to itself than a
          # plain listener stop + process exit, and on a machine running a VPN
          # client or an EDR/security agent that kind of self-termination call
          # can be exactly the sort of thing that gets intercepted, delayed or
          # silently swallowed - the UI would report success while the server
          # never actually went down. $listener.Stop() + Environment.Exit(0)
          # is what this app shipped with originally and is a completely
          # ordinary .NET shutdown path with nothing that reads as evasive.
          # The short sleep gives the response time to actually leave the
          # socket before the listener that carries it goes away.
          Start-Sleep -Milliseconds 300
          # v12.2: leave the readable Excel copy of the project data current
          if ($script:InfoDirty) { [void](Update-InfoWorkbook -Force) }
          try { $listener.Stop() } catch { }
          try { $mutex.ReleaseMutex() } catch { }
          try { $mutex.Dispose() } catch { }
          Write-Log 'Stopped by user request.'
          [System.Environment]::Exit(0)
        }
      }
      elseif ($method -eq 'POST' -and $path -eq '/api/open-path') {
        # Launches Windows Explorer on the SERVER machine - same class of
        # action as /api/shutdown, so it gets the same loopback-only guard.
        # There is no further path restriction (e.g. "must be inside the
        # vault") beyond that: every path this endpoint is ever asked to open
        # is one the server itself already handed back to the client (a filed
        # document, a generated LL_info.xlsx, the vault root), so locality is
        # the only boundary that actually matters here.
        $okLocal = Test-LoopbackRequest -Request $req
        if (-not $okLocal) {
          New-JsonResponse -Response $res -StatusCode 403 -Body @{
            error = 'This action may only be requested from this machine.'
          }
        } else {
          $body = Read-JsonBody -Request $req
          $target = [string]$body.path
          if (-not $target) {
            New-JsonResponse -Response $res -StatusCode 400 -Body @{ error = 'path is required.' }
          } elseif (-not (Test-Path -LiteralPath $target)) {
            New-JsonResponse -Response $res -StatusCode 400 -Body @{ error = 'That path does not exist on this machine.' }
          } else {
            try {
              if (Test-Path -LiteralPath $target -PathType Leaf) {
                # /select, has no space after the comma - Explorer's undocumented
                # switch parser treats "/select, C:\..." (with the space) as two
                # separate malformed arguments instead of one.
                Start-Process explorer.exe -ArgumentList "/select,`"$target`""
              } else {
                Start-Process explorer.exe -ArgumentList "`"$target`""
              }
              New-JsonResponse -Response $res -StatusCode 200 -Body @{ ok = $true }
            } catch {
              New-JsonResponse -Response $res -StatusCode 500 -Body @{ error = 'Could not launch Explorer: ' + $_.Exception.Message }
            }
          }
        }
      }
      elseif ($method -eq 'POST' -and $path -eq '/api/filename/preview') {
        # lets the browser show the name before anything is written
        $body = Read-JsonBody -Request $req
        $n = Get-StandardFileName -DocType $body.docType -Model $body.family -WvnId $body.wvnId `
               -WnbId $body.wnbId -Description $body.description -OriginalName ([string]$body.fileName) `
               -Category $body.partId -ProjectId $body.projectId -Config (Get-Config)
        New-JsonResponse -Response $res -StatusCode 200 -Body @{ fileName = $n }
      }
      elseif ($method -eq 'GET' -and $path -like '/api/package/*') {
        # Transfer package: every filed document for one project, zipped, with a
        # manifest. Deliberately works on an incomplete project - the point is
        # to hand over what exists today.
        $projectId = [System.Uri]::UnescapeDataString($path.Substring('/api/package/'.Length))
        $rows = @(Read-Store 'lb_deliverables' | Where-Object { $_.project_id -eq $projectId })
        $proj = @(Read-Store 'lb_projects' | Where-Object { $_.project_id -eq $projectId })
        if (-not $proj.Count) { throw "unknown project '$projectId'" }
        $safePid = ConvertTo-NamePart $projectId
        $stage = Join-Path $env:TEMP ('wvnpkg_' + [guid]::NewGuid().ToString('N').Substring(0, 8))
        New-Item -ItemType Directory -Path $stage -Force | Out-Null
        try {
          $manifest = New-Object System.Collections.Generic.List[string]
          $manifest.Add('Transfer package for ' + $projectId)
          $manifest.Add('Generated ' + (Get-Date).ToUniversalTime().ToString('u') + ' by the WVN NPI & ECN Command Center')
          $manifest.Add('')
          $manifest.Add('THIS PACKAGE IS A SNAPSHOT OF WHAT HAS BEEN FILED, NOT A CERTIFICATE OF COMPLETENESS.')
          $manifest.Add('')
          # v11: only rows that ARE evidence (claim / custom-doc markers carry
          # no file and used to be listed as "FILE NOT FOUND"). The active
          # revision of each document sits in its step folder; superseded
          # revisions are kept, clearly apart, in <step>\_superseded.
          $manifest.Add(('Step' + "`t" + 'Document' + "`t" + 'Rev' + "`t" + 'Status' + "`t" + 'File or link' + "`t" + 'Filed by' + "`t" + 'Approved' + "`t" + 'SHA-256'))
          $copied = 0; $missing = 0; $links = 0; $superseded = 0
          foreach ($r in @($rows | Where-Object { $_.revision_no })) {
            $revState = if ($r.is_active -eq 'YES') { 'active' } else { 'superseded' }
            $revCols = [string]$r.revision_no + "`t" + $revState + "`t"
            if ([string]$r.kind -eq 'link') {
              $links++
              $manifest.Add(($r.step_key + "`t" + $r.doc_code + "`t" + $revCols + '[link] ' + $r.link_url + "`t" + $r.uploaded_by + "`t" + $r.approved + "`t"))
              continue
            }
            $src = [string]$r.file_path
            if ($src -and (Test-Path -LiteralPath $src -PathType Leaf)) {
              $sub = Join-Path $stage (ConvertTo-NamePart $r.step_key)
              if ($revState -eq 'superseded') { $sub = Join-Path $sub '_superseded'; $superseded++ }
              if (-not (Test-Path -LiteralPath $sub)) { New-Item -ItemType Directory -Path $sub -Force | Out-Null }
              $dest = Join-Path $sub ([System.IO.Path]::GetFileName($src))
              if (-not (Test-Path -LiteralPath $dest)) { Copy-Item -LiteralPath $src -Destination $dest -Force }
              $copied++
              $manifest.Add(($r.step_key + "`t" + $r.doc_code + "`t" + $revCols + [System.IO.Path]::GetFileName($src) + "`t" + $r.uploaded_by + "`t" + $r.approved + "`t" + $r.sha256))
            } else {
              $missing++
              $manifest.Add(($r.step_key + "`t" + $r.doc_code + "`t" + $revCols + '*** FILE NOT FOUND: ' + $src + "`t" + $r.uploaded_by + "`t" + $r.approved + "`t" + $r.sha256))
            }
          }
          $manifest.Add('')
          $manifest.Add(('Files included: ' + $copied + ' (of which superseded revisions: ' + $superseded + ')   links cited: ' + $links + '   missing from disk: ' + $missing))
          Set-Content -LiteralPath (Join-Path $stage '_MANIFEST.txt') -Value ($manifest -join "`r`n") -Encoding UTF8

          $zipPath = Join-Path $env:TEMP ($safePid + '_Transfer_Package.zip')
          if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }
          Add-Type -AssemblyName System.IO.Compression.FileSystem
          [System.IO.Compression.ZipFile]::CreateFromDirectory($stage, $zipPath, [System.IO.Compression.CompressionLevel]::Optimal, $false)
          $zipBytes = [System.IO.File]::ReadAllBytes($zipPath)
          Remove-Item -LiteralPath $zipPath -Force
          $res.StatusCode = 200
          $res.ContentType = 'application/zip'
          $res.AddHeader('Content-Disposition', 'attachment; filename="' + $safePid + '_Transfer_Package.zip"')
          $res.ContentLength64 = $zipBytes.Length
          $res.OutputStream.Write($zipBytes, 0, $zipBytes.Length)
          $res.OutputStream.Close()
          Write-Log ('Transfer package for ' + $projectId + ': ' + $copied + ' file(s), ' + $links + ' link(s), ' + $missing + ' missing')
        } finally {
          if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue }
        }
      }
      elseif ($method -eq 'POST' -and $path -eq '/api/lfi') {
        $body = Read-JsonBody -Request $req
        $projectId  = [string]$body.project_id
        $family     = [string]$body.family
        $prodFamily = [string]$body.prod_family
        $stepKey    = [string]$body.step_key
        $stepId     = [string]$body.step_id
        $stepName   = [string]$body.step_name
        $title      = [string]$body.title
        $author     = [string]$body.author
        $dateVal    = [string]$body.date
        $plant      = [string]$body.plant
        $impact     = [string]$body.impact
        $desc       = [string]$body.description
        $rootCause  = [string]$body.root_cause
        $remediation = [string]$body.remediation
        $raisedBy   = [string]$body.raised_by
        $severity   = [string]$body.severity
        if ($severity -notin @('Critical', 'Major', 'Minor')) { $severity = 'Major' }
        $images     = $body.images

        $lfiNumber   = 'LFI-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
        $identifiedIn = "$projectId - $stepId $stepName"
        $timestamp   = Get-Date -Format 'yyyyMMdd-HHmmss'
        $stem        = "LFI_${family}_${stepKey}_${timestamp}"

        # Decode attachments up front: they are embedded INTO the workbook
        # while its archive is still open, so they cannot wait until after
        # the vault copy is written.
        $decodedImages = @()
        if ($images) {
          for ($imgIdx = 0; $imgIdx -lt $images.Count; $imgIdx++) {
            $img = $images[$imgIdx]
            $imgName = [string]$img.name
            $imgData = [string]$img.data
            $base64 = ''
            if ($imgData -match ';base64,(.+)$') { $base64 = $Matches[1] } else { $base64 = $imgData }
            if (-not $base64) { continue }
            try { $imgBytes = [System.Convert]::FromBase64String($base64) } catch { continue }
            $ext = ([System.IO.Path]::GetExtension($imgName)).TrimStart('.').ToLowerInvariant()
            if ($ext -notin @('png', 'jpg', 'jpeg')) { $ext = 'png' }
            $decodedImages += @{ name = $imgName; bytes = $imgBytes; ext = $ext }
          }
        }

        $tempPath    = Join-Path $env:TEMP ('lfi_' + [guid]::NewGuid().ToString('N') + '.xlsx')
        $templatePath = Join-Path $TemplatesDir 'LL_info.xlsx'
        Copy-Item -LiteralPath $templatePath -Destination $tempPath

        try {
          $archive = [System.IO.Compression.ZipFile]::Open($tempPath, 2)   # 2 = ZipArchiveMode.Update
          try {
            # ---- sheet1: LL INFO ---------------------------------------------------
            $s1entry = $null
            foreach ($e in $archive.Entries) { if ($e.FullName -eq 'xl/worksheets/sheet1.xml') { $s1entry = $e; break } }
            $s1rd = New-Object System.IO.StreamReader($s1entry.Open())
            $s1xml = $s1rd.ReadToEnd(); $s1rd.Close()

            function Set-InlineCell($xml, $ref, $val) {
              $safe = [System.Security.SecurityElement]::Escape([string]$val)
              # Match the existing (empty) cell for this ref, whether it is
              # written as <c .../> or <c ...></c>, and whatever its type.
              $pattern = '<c r="' + $ref + '"[^>]*?(?:/>|></c>)'
              $m = [regex]::Match($xml, $pattern)
              if (-not $m.Success) { return $xml }
              # Carry the style index across. The template's formatting (the
              # form's borders, fonts and fills) lives entirely in s="NNN";
              # dropping it on write turns the filled report into unformatted
              # text on a blank grid, which is the whole value of using a
              # pre-made template in the first place.
              $styleAttr = ''
              $sm = [regex]::Match($m.Value, '\ss="(\d+)"')
              if ($sm.Success) { $styleAttr = ' s="' + $sm.Groups[1].Value + '"' }
              $newCell = '<c r="' + $ref + '"' + $styleAttr + ' t="inlineStr"><is><t xml:space="preserve">' + $safe + '</t></is></c>'
              return $xml.Substring(0, $m.Index) + $newCell + $xml.Substring($m.Index + $m.Length)
            }

            # Cell refs MUST be the top-left ANCHOR of each merged range. A
            # value written to any other cell inside a merged block is
            # silently discarded by Excel - the workbook still opens fine, it
            # just comes out blank, which is the worst kind of failure here.
            # Anchors below were read off the template's own mergeCells list.
            $s1xml = Set-InlineCell $s1xml 'R1'  'LFI'            # Type:
            $s1xml = Set-InlineCell $s1xml 'Y1'  'Open'           # Solution Status:
            $s1xml = Set-InlineCell $s1xml 'C5'  $title           # Title:
            $s1xml = Set-InlineCell $s1xml 'C6'  $author          # Author:
            $s1xml = Set-InlineCell $s1xml 'G6'  $plant           # Plant:
            $s1xml = Set-InlineCell $s1xml 'K6'  $dateVal         # Date:
            $s1xml = Set-InlineCell $s1xml 'O6'  $lfiNumber       # LL INFO Number:
            $s1xml = Set-InlineCell $s1xml 'W6'  $impact          # Impact:
            $s1xml = Set-InlineCell $s1xml 'D9'  $projectId       # System:
            $s1xml = Set-InlineCell $s1xml 'K9'  "$stepId $stepName"  # Process:
            $s1xml = Set-InlineCell $s1xml 'U9'  $prodFamily      # Product Family:
            $s1xml = Set-InlineCell $s1xml 'D10' $family          # Machine Type:
            $s1xml = Set-InlineCell $s1xml 'U10' $family          # Product Name:
            $s1xml = Set-InlineCell $s1xml 'D11' '1'              # S.no:
            $s1xml = Set-InlineCell $s1xml 'K11' $identifiedIn    # PROBLEM IDENTIFIED IN:
            # The two big body panels. A14:L15 and M14:AA15 are the SECTION
            # HEADINGS ("PROBLEM / NEED..." and "SOLUTION / BEST PRACTICE") -
            # writing into those would overwrite the printed headings. The
            # actual writable panels are the blocks underneath: A16:L47 and
            # M16:AA47, anchored at A16 and M16.
            $s1xml = Set-InlineCell $s1xml 'A16' $desc
            if ($rootCause) { $combinedSolution = "Root Cause:`r`n$rootCause`r`n`r`nRemediation:`r`n$remediation" } else { $combinedSolution = $remediation }
            $s1xml = Set-InlineCell $s1xml 'M16' $combinedSolution

            $s1entry.Delete()
            $newS1 = $archive.CreateEntry('xl/worksheets/sheet1.xml')
            $w1 = New-Object System.IO.StreamWriter($newS1.Open())
            $w1.Write($s1xml); $w1.Close()

            # ---- sheet2: List Issue -------------------------------------------------
            $s2entry = $null
            foreach ($e in $archive.Entries) { if ($e.FullName -eq 'xl/worksheets/sheet2.xml') { $s2entry = $e; break } }
            $s2rd = New-Object System.IO.StreamReader($s2entry.Open())
            $s2xml = $s2rd.ReadToEnd(); $s2rd.Close()

            $rn = 3
            $newRow = '<row r="' + $rn + '" ht="34.5" customHeight="1">' +
              '<c r="A' + $rn + '" s="1"  t="inlineStr"><is><t>1</t></is></c>' +
              '<c r="B' + $rn + '" s="37" t="inlineStr"><is><t>' + [System.Security.SecurityElement]::Escape($dateVal) + '</t></is></c>' +
              '<c r="C' + $rn + '" s="38" t="inlineStr"><is><t>' + [System.Security.SecurityElement]::Escape($family) + '</t></is></c>' +
              '<c r="D' + $rn + '" s="39" t="n"></c>' +
              '<c r="E' + $rn + '" s="57" t="inlineStr"><is><t>' + [System.Security.SecurityElement]::Escape($title) + '</t></is></c>' +
              '<c r="F' + $rn + '" s="40" t="inlineStr"><is><t>' + [System.Security.SecurityElement]::Escape($identifiedIn) + '</t></is></c>' +
              '<c r="G' + $rn + '" s="40" t="inlineStr"><is><t>LFI</t></is></c>' +
              '<c r="H' + $rn + '" s="41" t="n"></c>' +
              '<c r="I' + $rn + '" s="58" t="n"></c>' +
              '<c r="J' + $rn + '" s="38" t="n"></c>' +
              '<c r="K' + $rn + '" s="38" t="n"></c>' +
              '<c r="M' + $rn + '" s="59" t="n"></c>' +
              '</row>'

            $s2xml = [regex]::Replace($s2xml, '<row r="3"[^>]*>.*?</row>', $newRow, [System.Text.RegularExpressions.RegexOptions]::Singleline)
            $s2entry.Delete()
            $newS2 = $archive.CreateEntry('xl/worksheets/sheet2.xml')
            $w2 = New-Object System.IO.StreamWriter($newS2.Open())
            $w2.Write($s2xml); $w2.Close()

            # ---- attached photos, anchored into the LL INFO form -----------------
            # The first photo's top-left corner lands at A16 (the PROBLEM
            # panel) and the second's at M16 (the SOLUTION panel) - the same
            # two blocks the description and remediation text are written
            # into above, so a photo illustrates the wording it sits beside.
            # v8.3: single-cell anchor at natural size, no stretch-to-fit -
            # toCol/toRow below are kept only so overflow images (a 3rd+
            # photo, past these two slots) still know how far to stack down.
            if ($decodedImages.Count -gt 0) {
              $lfiSlots = @(
                @{ fromCol = 0;  fromRow = 15; toCol = 11; toRow = 46 },
                @{ fromCol = 12; fromRow = 15; toCol = 26; toRow = 46 }
              )
              Add-XlsxImageAnchors -Archive $archive -SheetPath 'xl/worksheets/sheet1.xml' `
                -Images $decodedImages -Slots $lfiSlots
            }

          } finally {
            $archive.Dispose()
          }

          $xlsxBytes = [System.IO.File]::ReadAllBytes($tempPath)
          $savedXlsx = Save-Evidence -DocType 'LFI' -Family $family -PartId '' -FileName "${stem}.xlsx" -Bytes $xlsxBytes

          # The photos are already inside the workbook; these vault copies keep
          # the originals at full resolution for anyone who needs them apart
          # from the report.
          $savedImages = @()
          for ($imgIdx = 0; $imgIdx -lt $decodedImages.Count; $imgIdx++) {
            $dImg = $decodedImages[$imgIdx]
            $imgFileName = "${stem}_$($imgIdx+1)." + $dImg.ext
            $imgSaved = Save-Evidence -DocType 'LFI' -Family $family -PartId '' -FileName $imgFileName -Bytes $dImg.bytes
            $savedImages += @{ fileName = $imgSaved.fileName; path = $imgSaved.path }
          }

          # evidence_path lets the drawer link straight to the generated
          # workbook later, instead of the path being visible only in the
          # one-off submit response.
          Add-StoreRow -Store 'lb_issues' -IdField 'issue_id' -Row @{
            project_id    = $projectId
            step_key      = $stepKey
            raised_utc    = (Get-Date).ToUniversalTime().ToString('o')
            raised_by     = $raisedBy
            category      = 'LFI'
            description   = $title
            owner         = ''
            status        = 'Open'
            severity      = $severity
            evidence_path = $savedXlsx.path
          } | Out-Null

          $result = @{
            ok       = $true
            filename = $savedXlsx.fileName
            path     = $savedXlsx.path
            images   = $savedImages
          }
          New-JsonResponse -Response $res -StatusCode 200 -Body $result
          Write-Log ("LFI created: $stem for $projectId / $stepKey")

        } catch {
          Write-Log ("LFI failed: " + $_.Exception.Message) 'ERROR'
          # If the archive is still open from the inner try, its Dispose()
          # wasn't called.  The temp file is already locked; we can't recover
          # it, but we MUST still return an error to the client and let the
          # finally block clean up what it can.
          if (Test-Path -LiteralPath $tempPath) {
            # Best-effort: the file might still be locked by the ZipArchive.
            # The finally below handles the second attempt after stream closure.
          }
          New-JsonResponse -Response $res -StatusCode 500 -Body @{ error = $_.Exception.Message }

        } finally {
          if (Test-Path -LiteralPath $tempPath) {
            Remove-Item -LiteralPath $tempPath -Force -ErrorAction SilentlyContinue
          }
        }
      }
      elseif ($method -eq 'GET' -and $path -eq '/api/reports/download') {
                $typeKey     = (Get-QueryValue -Request $req -Name 'type')
                $famFilter   = (Get-QueryValue -Request $req -Name 'fam')
                $modelFilter = (Get-QueryValue -Request $req -Name 'model')
                $startFilter = (Get-QueryValue -Request $req -Name 'start')
                $endFilter   = (Get-QueryValue -Request $req -Name 'end')

                # Each report names the sheet it writes to. The three
                # RANKED_COLORS workbooks and LL_info all keep their data on
                # sheet2 with a formatted Dashboard on sheet1; the trial report
                # template has ONE sheet and it is the printed form, so that
                # one appends under the form instead of replacing it.
                # pctCols are 0-based column indexes Get-ReportData emits as
                # decimal fractions; they get Excel's built-in "0%" format so
                # 0.75 reads as 75% while staying a real number for AVERAGE()
                # and the Dashboard charts. headerIdx is which generated row
                # carries the column names — 'trial' leads with a caption row,
                # so its header is the second one.
                $templateMap = @{
                  'lfi'      = @{ file = 'Template_EPM_Issue_Analytics_RANKED_COLORS.xlsx';  sheet = 'xl/worksheets/sheet2.xml'; append = $false; pctCols = @();        headerIdx = 0 }
                  'transfer' = @{ file = 'Template_ProjectTransfer_Report_RANKED_COLORS.xlsx'; sheet = 'xl/worksheets/sheet2.xml'; append = $false; pctCols = @(6);       headerIdx = 0 }
                  'kpi'      = @{ file = 'Template_KPI_Report_RANKED_COLORS.xlsx';           sheet = 'xl/worksheets/sheet2.xml'; append = $false; pctCols = @(5, 6, 7); headerIdx = 0 }
                  'll'       = @{ file = 'LL_info.xlsx';                                     sheet = 'xl/worksheets/sheet2.xml'; append = $false; unhideSheet = 'List Issue'; pctCols = @(); headerIdx = 0 }
                  'trial'    = @{ file = 'NPI_Trial_Report_Template.xlsx';                   sheet = 'xl/worksheets/sheet1.xml'; append = $true;  pctCols = @(10);      headerIdx = 1 }
                }
                $spec = $templateMap[$typeKey]
                $templateName = if ($spec) { [string]$spec.file } else { '' }
                if (-not $templateName) {
                  New-JsonResponse -Response $res -StatusCode 400 -Body @{ error = "Unknown report type '$typeKey'" }
                } else {
                  $templatePath = Join-Path $TemplatesDir $templateName
                  if (-not (Test-Path -LiteralPath $templatePath -PathType Leaf)) {
                    New-JsonResponse -Response $res -StatusCode 404 -Body @{ error = "Template file not found: $templateName" }
                  } else {
                    $tempPath = Join-Path $env:TEMP ('wvnrpt_' + [guid]::NewGuid().ToString('N').Substring(0, 8) + '.xlsx')
                    Copy-Item -LiteralPath $templatePath -Destination $tempPath -Force
                    try {
                      # Generate data rows
                      $data = Get-ReportData -Type $typeKey -FamFilter $famFilter -ModelFilter $modelFilter -StartFilter $startFilter -EndFilter $endFilter
                      if ($data.Count -eq 0) {
                        $data = @(@('No data'))
                      }

                      # Read existing sheet2.xml from the template copy
                      Add-Type -AssemblyName System.IO.Compression
                      Add-Type -AssemblyName System.IO.Compression.FileSystem
                      $fs = [System.IO.File]::Open($tempPath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::ReadWrite)
                      $zip = New-Object System.IO.Compression.ZipArchive($fs, [System.IO.Compression.ZipArchiveMode]::Update)
                      $sheetPath   = [string]$spec.sheet
                      $appendMode  = [bool]$spec.append
                      $sheetEntry = $zip.GetEntry($sheetPath)
                      if (-not $sheetEntry) {
                        $zip.Dispose()
                        throw ("Template '" + $templateName + "' is missing " + $sheetPath)
                      }
                      $reader = New-Object System.IO.StreamReader($sheetEntry.Open(), [System.Text.Encoding]::UTF8)
                      $existingSheetXml = $reader.ReadToEnd()
                      $reader.Close()

                      # Detect namespace prefix convention
                      $ns = if ($existingSheetXml -match '<x:sheetData') { 'x:' } else { '' }

                      # Register this report's header/body/percent formats in
                      # the template's own styles.xml and keep the indexes they
                      # were assigned. If anything about that file is shaped
                      # unexpectedly the helper returns $null and generation
                      # falls back to unstyled output rather than risking a
                      # workbook Excel refuses to open.
                      $styleHeader = ''; $styleBody = ''; $stylePercent = ''
                      $stylesEntry = $zip.GetEntry('xl/styles.xml')
                      if ($stylesEntry) {
                        $stReader = New-Object System.IO.StreamReader($stylesEntry.Open(), [System.Text.Encoding]::UTF8)
                        $stylesXml = $stReader.ReadToEnd()
                        $stReader.Close()
                        $styleInfo = Add-ReportStyles -StylesXml $stylesXml
                        if ($styleInfo) {
                          $stylesEntry.Delete()
                          $stNew = $zip.CreateEntry('xl/styles.xml')
                          $stWriter = New-Object System.IO.StreamWriter($stNew.Open(), [System.Text.Encoding]::UTF8)
                          $stWriter.Write([string]$styleInfo.xml)
                          $stWriter.Close()
                          $styleHeader  = [string]$styleInfo.header
                          $styleBody    = [string]$styleInfo.body
                          $stylePercent = [string]$styleInfo.percent
                        } else {
                          Write-Log ("Report styling skipped for " + $templateName + " - unexpected styles.xml shape") 'WARN'
                        }
                      }

                      # Appended rows start past the template's own last row;
                      # reusing an existing r= makes Excel repair the file. The
                      # +1 leaves one blank row between the form and the
                      # appended block so they do not read as one table.
                      $rowOffset = 0
                      if ($appendMode) { $rowOffset = (Get-SheetMaxRow -SheetXml $existingSheetXml) + 1 }

                      # Build row XML
                      $pctCols   = @($spec.pctCols)
                      $headerIdx = [int]$spec.headerIdx
                      $rowsXml = New-Object System.Collections.Generic.List[string]
                      for ($ri = 0; $ri -lt $data.Count; $ri++) {
                        $rowsXml.Add((New-ReportRowXml -Values $data[$ri] -RowNum ($rowOffset + $ri + 1) -Ns $ns `
                          -BodyStyle $styleBody -PercentStyle $stylePercent -HeaderStyle $styleHeader `
                          -IsHeader:($ri -eq $headerIdx) -PctCols $pctCols))
                      }

                      # Replace (or extend) sheetData content
                      $newSheetXml = New-ReportSheetXml -Existing $existingSheetXml -RowsXml $rowsXml.ToArray() -Ns $ns -Append:$appendMode
                      # Widths and gridlines are only meaningful on the sheet
                      # this report actually writes its table to. The trial
                      # template's single sheet IS a printed form, so leave its
                      # column widths alone or the form collapses.
                      if (-not $appendMode) {
                        $maxCols = 0
                        foreach ($rowVals in $data) { if ($rowVals.Count -gt $maxCols) { $maxCols = $rowVals.Count } }
                        $newSheetXml = Set-ReportSheetChrome -SheetXml $newSheetXml -Ns $ns -ColCount $maxCols
                      }

                      # Delete old entry and write new one
                      $sheetEntry.Delete()
                      $newEntry = $zip.CreateEntry($sheetPath)
                      $writer = New-Object System.IO.StreamWriter($newEntry.Open(), [System.Text.Encoding]::UTF8)
                      $writer.Write($newSheetXml)
                      $writer.Close()

                      # workbook.xml touch-up: always force a full recalc on
                      # open, and unhide LL_info's feeder sheet when asked.
                      # The Dashboard sheets carry formulas whose cached <v>
                      # was computed against the template's placeholder data
                      # at authoring time - without fullCalcOnLoad, Excel can
                      # show those stale cached zeros instead of recalculating
                      # against the real Data rows just written above.
                      $wbEntry = $zip.GetEntry('xl/workbook.xml')
                      if ($wbEntry) {
                        $wbReader = New-Object System.IO.StreamReader($wbEntry.Open(), [System.Text.Encoding]::UTF8)
                        $wbXml = $wbReader.ReadToEnd()
                        $wbReader.Close()
                        if ($spec.unhideSheet) {
                          $pattern = '(<sheet\b[^>]*\bname="' + [regex]::Escape([string]$spec.unhideSheet) + '"[^>]*?)\s+state="(?:hidden|veryHidden)"'
                          $wbXml = [regex]::Replace($wbXml, $pattern, '$1')
                        }
                        # Some templates use a bare <workbook>/<calcPr>, others
                        # (the RANKED_COLORS suite) prefix every element with
                        # x: (<x:workbook>, would be <x:calcPr>). Detect which
                        # convention this file uses so both the match and the
                        # inserted element agree with it.
                        $wbPfx = if ($wbXml -match '<(\w+:)?workbook\b') { $Matches[1] } else { '' }
                        if ($wbXml -match ('<' + $wbPfx + 'calcPr\b[^/]*/>')) {
                          if ($wbXml -notmatch ('<' + $wbPfx + 'calcPr\b[^/]*\bfullCalcOnLoad=')) {
                            $wbXml = [regex]::Replace($wbXml, '<' + $wbPfx + 'calcPr\b([^/]*)/>', '<' + $wbPfx + 'calcPr$1 fullCalcOnLoad="1"/>')
                          }
                        } else {
                          $wbXml = $wbXml.Replace('</' + $wbPfx + 'workbook>', '<' + $wbPfx + 'calcPr fullCalcOnLoad="1"/></' + $wbPfx + 'workbook>')
                        }
                        $wbEntry.Delete()
                        $wbNewEntry = $zip.CreateEntry('xl/workbook.xml')
                        $wbWriter = New-Object System.IO.StreamWriter($wbNewEntry.Open(), [System.Text.Encoding]::UTF8)
                        $wbWriter.Write($wbXml)
                        $wbWriter.Close()
                      }
                      $zip.Dispose()
                      $fs.Close()

                      # Stream the result
                      $bytes = [System.IO.File]::ReadAllBytes($tempPath)
                      # Timestamp to the second, not the day. The download is a
                      # plain GET on a stable URL, so two reports pulled on the
                      # same day landed on the same filename and the browser
                      # happily re-served the first one from cache - the report
                      # appeared not to pick up any change made to a project.
                      $filename = 'Report_' + $typeKey + '_' + (Get-Date -Format 'yyyyMMdd_HHmmss') + '.xlsx'
                      $res.StatusCode = 200
                      $res.ContentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                      # Same reason: this response is generated per request from
                      # live CSV state and must never be cached.
                      $res.Headers.Add('Cache-Control', 'no-store, no-cache, must-revalidate')
                      $res.Headers.Add('Pragma', 'no-cache')
                      $res.AddHeader('Content-Disposition', 'attachment; filename="' + $filename + '"')
                      $res.ContentLength64 = $bytes.Length
                      $res.OutputStream.Write($bytes, 0, $bytes.Length)
                      $res.OutputStream.Close()
                      Write-Log ('Report downloaded: ' + $typeKey)
                    } finally {
                      if (Test-Path -LiteralPath $tempPath) { Remove-Item -LiteralPath $tempPath -Force -ErrorAction SilentlyContinue }
                    }
                  }
                }
              }
              else {
                New-JsonResponse -Response $res -StatusCode 404 -Body @{ error = 'not found' }
      }
    } catch {
      Write-Log ('Request failed: ' + $req.Url + ' — ' + $_.Exception.Message) 'ERROR'
      try { New-JsonResponse -Response $res -StatusCode 500 -Body @{ error = $_.Exception.Message } } catch { }
    }
    # v12.2: after the response is out, bring the readable Excel copy of the
    # vault's project data up to date if anything was written (throttled).
    [void](Update-InfoWorkbook)
  }
} finally {
  # Every step is guarded: on the /api/shutdown path the background runspace
  # has already stopped the listener, so GetContext() throws and unwinds to
  # here. An unguarded Stop()/ReleaseMutex() would then throw again and turn a
  # clean, user-requested shutdown into a non-zero exit with a red error dump.
  try { $listener.Stop() } catch { }
  try { $mutex.ReleaseMutex() } catch { }
  Write-Log 'Stopped.'
}
