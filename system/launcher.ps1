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
  [switch]$NoBrowser
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

# ============================================================ paths & log ==
$SystemDir  = $PSScriptRoot
if (-not $SystemDir) { $SystemDir = Split-Path -Parent $MyInvocation.MyCommand.Path }
$RootDir      = Split-Path -Parent $SystemDir
$ConfigPath   = Join-Path $SystemDir 'config.json'
$TrackingDir  = Join-Path $SystemDir 'tracking'
$TemplatesDir = Join-Path $SystemDir 'templates'
$StagingDir   = Join-Path $SystemDir 'tmp_staging'
$LogDir       = Join-Path $SystemDir 'logs'
$LogPath      = Join-Path $LogDir 'launcher.log'
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
      Start-Sleep -Milliseconds $DelayMs
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
  $json = $ConfigObj | ConvertTo-Json -Depth 12
  Invoke-Locked -Path $ConfigPath -Action { param($s) Write-AllText $s $json }.GetNewClosure() | Out-Null
}

# ---- first-launch / self-healing deployment path --------------------------
try {
  $cfg = Get-Config
  $actualRoot = $RootDir
  $changed = $false
  if (-not $cfg.system_info.deployment_path) {
    Add-Type -AssemblyName System.Windows.Forms | Out-Null
    $picker = New-Object System.Windows.Forms.FolderBrowserDialog
    $picker.Description = 'Choose the folder this tool was deployed into (cancel to use the current location).'
    $picker.SelectedPath = $actualRoot
    $chosen = $actualRoot
    try { if ($picker.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK -and $picker.SelectedPath) { $chosen = $picker.SelectedPath } } catch { }
    $cfg.system_info.deployment_path = $chosen
    $changed = $true
    Write-Log ('First-launch deployment_path set to ' + $chosen)
  } elseif ($cfg.system_info.deployment_path -ne $actualRoot) {
    Write-Log ('deployment_path stale (' + $cfg.system_info.deployment_path + ') — self-healing to ' + $actualRoot)
    $cfg.system_info.deployment_path = $actualRoot
    $changed = $true
  }
  if ($changed) { Save-Config $cfg }
} catch {
  Write-Log ('Startup config check failed: ' + $_.Exception.Message) 'ERROR'
}

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

  $vault = [string]$dd.evidence_vault_path
  # evidence_vault_root records which app folder that vault path was resolved
  # FOR. If this copy of the tool is running from somewhere else — moved,
  # copied, or a second deployment on the same machine — the stored path
  # belongs to a different install and must not be reused, or two deployments
  # quietly share one vault. Only a vault resolved for THIS root, whose parent
  # still exists, is honoured; that keeps a deliberately customised path.
  $vaultRoot = [string]$dd.evidence_vault_root
  $reason = ''
  if (-not $vault) { $reason = 'no vault configured' }
  elseif ($vaultRoot -ne $RootDir) { $reason = "configured for a different install ($vaultRoot)" }
  elseif (-not (Test-Path -LiteralPath (Split-Path -Parent $vault))) { $reason = 'parent folder is gone' }
  if ($reason) {
    if ($vault) { Write-Log ("Vault path " + $vault + " not used — " + $reason + ". Using " + $defaultVault) 'WARN' }
    $vault = $defaultVault
    $cfg.deployment_defaults.evidence_vault_path = $vault
    $cfg.deployment_defaults | Add-Member -NotePropertyName evidence_vault_root -NotePropertyValue $RootDir -Force
    Save-Config $cfg
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
  lb_gates        = @('gate_id','project_id','process','step_key','step_num','step_name','status','complexity','batch_1','batch_2','batch_3','batch_override','batch_justification','approved_by','approved_utc','evidence_cited','notes','updated_utc','owner_pic','claimed_by','claimed_utc','supporter_pic','supporter_by','supporter_utc','assigned_by','assigned_utc')
  # v2.2 appended kind..link_url. `kind` is 'file' for an uploaded document and
  # 'link' for a UNC path or URL that lives somewhere else and is only cited.
  lb_deliverables = @('deliverable_id','project_id','step_key','doc_code','file_name','file_path','sha256','status','approved','suspect_template','uploaded_by','uploaded_utc','notes','kind','original_name','wvn_id','wnb_id','description','link_url','custom_doc','owner_pic','claimed_by','claimed_utc','supporter_pic','supporter_by','supporter_utc','assigned_by','assigned_utc')
  lb_doc_comments = @('comment_id','project_id','deliverable_id','doc_code','step_key','author','comment','created_utc')
  # v2.3 — shared with the standalone WVN_Ticketing_Center, which points at
  # this same tracking folder. lb_ticket_events is append-only by convention:
  # nothing in either app ever updates or deletes a row in it.
  lb_tickets      = @('ticket_id','project_id','step_key','doc_code','title','description','requested_by','requested_dept','requested_utc','assigned_dept','assigned_to','priority','due_date','status','fulfilled_by','fulfilled_utc','deliverable_id','sha256','close_note')
  lb_ticket_events= @('event_id','ticket_id','timestamp_utc','actor','actor_role','action','detail','sha256')
  lb_sp_issues    = @('sp_id','project_id','title','description','raised_by','raised_utc','owner_dept','owner_pic','due_date','status','action_taken','remarks','attachment_name','attachment_path','last_message_by','last_message_utc','last_message','priority','assigned_dept','claimed_by','claimed_utc','supporter_pic','supporter_by','supporter_utc','assigned_by','assigned_utc')
  lb_approvals    = @('approval_id','project_id','step_key','deliverable_id','approved_by','approved_utc','approval_type','evidence_count','comments')
  lb_bypasses     = @('bypass_id','project_id','step_key','authorised_by','authorised_utc','reason','mitigation','supersede_by','closed_utc','closed_note')
  lb_issues       = @('issue_id','project_id','step_key','raised_utc','raised_by','category','description','owner','due_date','status','resolution','closed_utc','owner_pic','claimed_by','claimed_utc','supporter_pic','supporter_by','supporter_utc','assigned_by','assigned_utc','severity')
  lb_ppap         = @('ppap_id','project_id','part_number','customer','doc_code','required','submitted_utc','customer_approved','customer_approved_utc','notes')
  # v3.6 removed lb_d365 entirely: it was genuinely dead, left behind when the
  # D365 entry log tab was cut from Input — nothing ever read TRK.lb_d365.
  # v4.2 removed lb_warehouse for the same reason, one step later. It had been
  # kept only because gateState()/whReady() still read it to decide whether a
  # step with warehouse_gate_required could be approved; warehouse clearance
  # is no longer a gate condition anywhere, so nothing reads or writes it.
  lb_mwer         = @('mwer_id','project_id','step_key','meeting_type','meeting_date','attendees','summary','evidence_file','evidence_body','decision','conditions','logged_by','logged_utc')
  lb_audit        = @('log_id','timestamp_utc','user','action','project_id','object_type','object_id','change_from','change_to','detail','result')
}
$IdPrefix = @{
  lb_gates='GATE'; lb_deliverables='DEL'; lb_approvals='APR'; lb_bypasses='BYP'; lb_issues='LFI';
  lb_ppap='PPAP'; lb_mwer='MWER'; lb_audit='LOG'; lb_doc_comments='CMT'
  lb_tickets='TKT'; lb_ticket_events='EVT'; lb_sp_issues='SPI'
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

# Appends MANY rows under a SINGLE exclusive lock (v3.1, batch import).
#
# Calling Add-StoreRow in a loop would take and release the lock once per row,
# so a concurrent writer could interleave between rows and a failure halfway
# through would leave a partially-imported file. This reads, assigns every ID,
# appends every row and writes back exactly once - so the import is all-or-
# nothing and IDs cannot collide with each other or with a concurrent submit.
#
# $Rows is an array of hashtables. Returns the assigned ID strings in order.
function Add-StoreRowsBatch {
  param([string]$Store, [object[]]$Rows, [string]$IdField, [hashtable]$IdCandidates)
  $path = CsvPath $Store
  $cols = $Stores[$Store]
  Invoke-Locked -Path $path -Action {
    param($s)
    $text = Read-AllText $s
    $lines = if ($text) { $text -split "`r?`n" | Where-Object { $_ -ne '' } } else { @() }
    $existing = New-Object System.Collections.Generic.List[object]
    for ($i = 1; $i -lt $lines.Count; $i++) {
      $vals = ConvertFrom-CsvLine $lines[$i]
      $o = @{}
      for ($c = 0; $c -lt $cols.Count; $c++) { $o[$cols[$c]] = if ($c -lt $vals.Count) { $vals[$c] } else { '' } }
      $existing.Add($o)
    }
    $taken = @{}
    foreach ($r in $existing) { $taken[([string]$r[$IdField]).ToUpperInvariant()] = $true }

    # plain array, not List[string] - see the note in the batch route: a
    # generic List round-tripped through @() breaks ConvertTo-Json on PS 5.1,
    # and this value goes straight into the JSON response.
    $assigned = @()
    foreach ($row in $Rows) {
      $cand = [string]$IdCandidates[[string]$row['__key']]
      $try = $cand; $n = 1
      while ($taken.ContainsKey($try.ToUpperInvariant())) { $n++; $try = $cand + '-' + $n }
      $taken[$try.ToUpperInvariant()] = $true
      $row[$IdField] = $try
      $assigned += $try
      $full = @{}
      foreach ($c in $cols) { $full[$c] = if ($row.ContainsKey($c) -and $null -ne $row[$c]) { [string]$row[$c] } else { '' } }
      $existing.Add($full)
    }

    $sb = New-Object System.Text.StringBuilder
    [void]$sb.Append(($cols -join ',')); [void]$sb.Append("`r`n")
    foreach ($r in $existing) {
      $cells = foreach ($c in $cols) { ConvertTo-CsvCell $r[$c] }
      [void]$sb.Append(($cells -join ',')); [void]$sb.Append("`r`n")
    }
    Write-AllText $s $sb.ToString()
    return ,$assigned
  }.GetNewClosure()
}

# Reads a store; creates an empty header-only file the first time it's touched.
function Read-Store { param([string]$Store)
  $path = CsvPath $Store
  $cols = $Stores[$Store]
  if (-not (Test-Path -LiteralPath $path)) { return @() }
  Invoke-Locked -Path $path -Action {
    param($s)
    $text = Read-AllText $s
    if (-not $text) { return @() }
    $lines = $text -split "`r?`n" | Where-Object { $_ -ne '' }
    if ($lines.Count -le 1) { return @() }
    $rows = New-Object System.Collections.Generic.List[object]
    for ($i = 1; $i -lt $lines.Count; $i++) {
      $vals = ConvertFrom-CsvLine $lines[$i]
      $o = [ordered]@{}
      for ($c = 0; $c -lt $cols.Count; $c++) { $o[$cols[$c]] = if ($c -lt $vals.Count) { $vals[$c] } else { '' } }
      $rows.Add([pscustomobject]$o)
    }
    return ,$rows
  }
}

# Appends one row under an exclusive lock, assigning its ID inside the same
# critical section so two concurrent submits can never collide. $IdPrefixOverride
# lets callers key the sequence by something other than the store's fixed
# prefix (projects are NPI-#### / ECN-#### depending on process).
# $IdCandidate (v2.1) takes a human-meaningful ID such as NPI-9649LP and makes
# it unique inside the lock by appending -2, -3 ... on collision.
function Add-StoreRow {
  param([string]$Store, [hashtable]$Row, [string]$IdField, [string]$IdPrefixOverride, [string]$IdCandidate)
  $path = CsvPath $Store
  $cols = $Stores[$Store]
  Invoke-Locked -Path $path -Action {
    param($s)
    $text = Read-AllText $s
    $existed = [bool]$text
    $lines = if ($text) { $text -split "`r?`n" | Where-Object { $_ -ne '' } } else { @() }
    $rows = New-Object System.Collections.Generic.List[object]
    for ($i = 1; $i -lt $lines.Count; $i++) {
      $vals = ConvertFrom-CsvLine $lines[$i]
      $o = @{}
      for ($c = 0; $c -lt $cols.Count; $c++) { $o[$cols[$c]] = if ($c -lt $vals.Count) { $vals[$c] } else { '' } }
      $rows.Add($o)
    }
    if ($IdField -and -not $Row[$IdField]) {
      if ($IdCandidate) {
        $taken = @{}
        foreach ($r in $rows) { $taken[([string]$r[$IdField]).ToUpperInvariant()] = $true }
        $try = $IdCandidate; $n = 1
        while ($taken.ContainsKey($try.ToUpperInvariant())) { $n++; $try = $IdCandidate + '-' + $n }
        $Row[$IdField] = $try
      } else {
        $prefix = if ($IdPrefixOverride) { $IdPrefixOverride } else { $IdPrefix[$Store] }
        $max = 0
        foreach ($r in $rows) {
          $id = [string]$r[$IdField]
          if ($id -match [regex]::Escape($prefix + '-') + '(\d+)$') { $n = [int]$Matches[1]; if ($n -gt $max) { $max = $n } }
        }
        $Row[$IdField] = '{0}-{1:D4}' -f $prefix, ($max + 1)
      }
    }
    $full = @{}
    foreach ($c in $cols) { $full[$c] = if ($Row.ContainsKey($c) -and $null -ne $Row[$c]) { [string]$Row[$c] } else { '' } }
    $rows.Add($full)

    $sb = New-Object System.Text.StringBuilder
    [void]$sb.Append(($cols -join ','))
    [void]$sb.Append("`r`n")
    foreach ($r in $rows) {
      $cells = foreach ($c in $cols) { ConvertTo-CsvCell $r[$c] }
      [void]$sb.Append(($cells -join ','))
      [void]$sb.Append("`r`n")
    }
    Write-AllText $s $sb.ToString()
    return [pscustomobject]$full
  }
}

# Upsert-by-key for stores where the same logical record is touched
# repeatedly (gate status, trial quantities). Matches on $KeyFields (all
# must be equal); replaces the row if found, else appends via Add-StoreRow.
function Set-StoreRow {
  param([string]$Store, [hashtable]$Row, [string[]]$KeyFields, [string]$IdField)
  $path = CsvPath $Store
  $cols = $Stores[$Store]
  Invoke-Locked -Path $path -Action {
    param($s)
    $text = Read-AllText $s
    $lines = if ($text) { $text -split "`r?`n" | Where-Object { $_ -ne '' } } else { @() }
    $rows = New-Object System.Collections.Generic.List[object]
    for ($i = 1; $i -lt $lines.Count; $i++) {
      $vals = ConvertFrom-CsvLine $lines[$i]
      $o = @{}
      for ($c = 0; $c -lt $cols.Count; $c++) { $o[$cols[$c]] = if ($c -lt $vals.Count) { $vals[$c] } else { '' } }
      $rows.Add($o)
    }
    $idx = -1
    for ($i = 0; $i -lt $rows.Count; $i++) {
      $match = $true
      foreach ($k in $KeyFields) { if ([string]$rows[$i][$k] -ne [string]$Row[$k]) { $match = $false; break } }
      if ($match) { $idx = $i; break }
    }
    if ($idx -ge 0) {
      foreach ($c in $cols) { if ($Row.ContainsKey($c) -and $null -ne $Row[$c]) { $rows[$idx][$c] = [string]$Row[$c] } }
      $full = $rows[$idx]
    } else {
      if ($IdField -and -not $Row[$IdField]) {
        $prefix = $IdPrefix[$Store]
        $max = 0
        foreach ($r in $rows) {
          $id = [string]$r[$IdField]
          if ($id -match [regex]::Escape($prefix + '-') + '(\d+)$') { $n = [int]$Matches[1]; if ($n -gt $max) { $max = $n } }
        }
        $Row[$IdField] = '{0}-{1:D4}' -f $prefix, ($max + 1)
      }
      $full = @{}
      foreach ($c in $cols) { $full[$c] = if ($Row.ContainsKey($c) -and $null -ne $Row[$c]) { [string]$Row[$c] } else { '' } }
      $rows.Add($full)
    }
    $sb = New-Object System.Text.StringBuilder
    [void]$sb.Append(($cols -join ','))
    [void]$sb.Append("`r`n")
    foreach ($r in $rows) {
      $cells = foreach ($c in $cols) { ConvertTo-CsvCell $r[$c] }
      [void]$sb.Append(($cells -join ','))
      [void]$sb.Append("`r`n")
    }
    Write-AllText $s $sb.ToString()
    return [pscustomobject]$full
  }
}

function Add-Audit { param([string]$User, [string]$Action, [string]$ProjectId, [string]$ObjType, [string]$ObjId, [string]$From, [string]$To, [string]$Detail)
  Add-StoreRow -Store 'lb_audit' -IdField 'log_id' -Row @{
    timestamp_utc = (Get-Date).ToUniversalTime().ToString('o'); user = $User; action = $Action
    project_id = $ProjectId; object_type = $ObjType; object_id = $ObjId
    change_from = $From; change_to = $To; detail = $Detail; result = 'Success'
  } | Out-Null
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

function Get-StandardFileName {
  param([string]$DocType, [string]$Model, [string]$WvnId, [string]$WnbId, [string]$Description, [string]$OriginalName)
  $ext = ([System.IO.Path]::GetExtension($OriginalName)).ToLowerInvariant()
  # fall back to the original stem when no description was given, so a file is
  # never reduced to just its codes
  if (-not $Description) { $Description = [System.IO.Path]::GetFileNameWithoutExtension($OriginalName) }

  # The drawing pattern is only meaningful with a WVN code — without one it
  # degenerates to "PD_01 name.pdf", which reads like a real part code and is
  # not. Fall through to the generic shape instead of minting a fake one.
  if ($DocType -eq 'DWG' -and (ConvertTo-NamePart $WvnId)) {
    $wvn  = ConvertTo-NamePart $WvnId
    $wnb  = ConvertTo-NamePart $WnbId
    $desc = ConvertTo-NamePart $Description -KeepSpaces
    # Build from non-empty suffix segments, each carrying its own separator so
    # every combination of blank inputs is provably safe — no orphaned space,
    # no dangling underscore, no double separator.
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
  # ConvertTo-NamePart already trims '_', ' ', '.' from every part and
  # collapses internal runs of underscores, so the join can never produce a
  # leading/trailing separator or a double underscore. The outer Trim is a
  # belt-and-suspenders guard against a single-element array edge case.
  return (($parts -join '_').Trim('_', ' ', '.')) + $ext
}

function Save-Evidence {
  param([string]$DocType, [string]$Family, [string]$PartId, [string]$FileName, [byte[]]$Bytes)
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
  $destDir = (@($EvidenceDir) + $levels) -join '\'
  if (-not (Test-Path -LiteralPath $destDir)) { New-Item -ItemType Directory -Path $destDir -Force | Out-Null }

  $safeFile = Get-SafeName $FileName
  $ext = [System.IO.Path]::GetExtension($safeFile)
  $base = [System.IO.Path]::GetFileNameWithoutExtension($safeFile)
  $destPath = Join-Path $destDir $safeFile

  $sha = [System.Security.Cryptography.SHA256]::Create()
  $newHash = ([BitConverter]::ToString($sha.ComputeHash($Bytes))).Replace('-', '').ToLowerInvariant()
  $sha.Dispose()

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
  $reader = New-Object System.IO.StreamReader($Request.InputStream, $Request.ContentEncoding)
  $text = $reader.ReadToEnd(); $reader.Close()
  if (-not $text) { return @{} }
  return $text | ConvertFrom-Json
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

function New-ReportCellXml { param([string]$Col, $Value, [int]$Row, [string]$Ns)
  $ref = "${Col}${Row}"
  $s = [string]$Value
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
    return "<${Ns}c r=`"${ref}`"><${Ns}v>$s</${Ns}v></${Ns}c>"
  }
  $safe = ConvertTo-XmlSafe $s
  return "<${Ns}c r=`"${ref}`" t=`"inlineStr`"><${Ns}is><${Ns}t>$safe</${Ns}t></${Ns}is></${Ns}c>"
}

function New-ReportRowXml { param([string[]]$Values, [int]$RowNum, [string]$Ns)
  $cells = for ($ci = 0; $ci -lt $Values.Count; $ci++) {
    New-ReportCellXml -Col (ConvertTo-ExcelCol $ci) -Value $Values[$ci] -Row $RowNum -Ns $Ns
  }
  return "<${Ns}row r=`"${RowNum}`">$($cells -join '')</${Ns}row>"
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
  if ($StepKey -notmatch '^(NPI|ECN)-(\d+)$') { return $StepKey }
  $proc = $Matches[1]
  $stepId = [int]$Matches[2]
  $steps = if ($proc -eq 'NPI') { $Config.npi_workflow.steps } else { $Config.ecn_workflow.steps }
  $step = @($steps) | Where-Object { [int]$_.step_id -eq $stepId } | Select-Object -First 1
  if ($step) { return [string]$step.step_name }
  return $StepKey
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

  # Build progress cache: project_id -> { pct, done, total, complete, missingDocs }
  $progressCache = @{}
  foreach ($p in $projects) {
    $proc = $p.process
    # $config has no "step_models" key — the real step lists live under
    # npi_workflow.steps / ecn_workflow.steps (see lines ~1332-1334 below for
    # the same lookup). The old path silently resolved to $null, so $total
    # was always 0 and every report's Completion % was always 0.
    $steps = if ($proc -eq 'NPI') { $config.npi_workflow.steps } else { $config.ecn_workflow.steps }
    if (-not $steps) { $steps = @() }
    $gated = @($steps | Where-Object {
      if ($proc -eq 'NPI') { $true } else { [bool]$_.gate_clearance_required }
    })
    $total = $gated.Count
    $done = 0
    $missingDocs = 0
    foreach ($step in $gated) {
      $sk = "$proc-$($step.step_id)"
      $appr = @($allApprovals | Where-Object { $_.project_id -eq $p.project_id -and $_.step_key -eq $sk })
      $byp  = @($allBypasses  | Where-Object { $_.project_id -eq $p.project_id -and $_.step_key -eq $sk -and -not $_.closed_utc })
      if ($appr.Count -gt 0 -or $byp.Count -gt 0) { $done++ }
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
    $progressCache[$p.project_id] = @{ pct = $pct; done = $done; total = $total; complete = $complete; missingDocs = $missingDocs }
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
      'Target Date','Market Manager','Country','Customer Number','Project Status','Notes')
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
        $p.target_date, $p.market_manager, $p.country, $p.customer_number, $p.status, $p.notes
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

try {
  while ($listener.IsListening) {
    $context = $listener.GetContext()
    $req = $context.Request
    $res = $context.Response
    try {
      $path = $req.Url.AbsolutePath
      $method = $req.HttpMethod

      if ($method -eq 'GET' -and ($path -eq '/' -or $path -eq '/index.html')) {
        New-FileResponse -Response $res -Path (Join-Path $SystemDir 'index.html') -ContentType $MimeTypes['.html']
      }
      elseif ($method -eq 'GET' -and $path -match '^/(styles\.css|app\.js)$') {
        $file = Join-Path $SystemDir $Matches[1]
        $ext = [System.IO.Path]::GetExtension($file)
        New-FileResponse -Response $res -Path $file -ContentType $MimeTypes[$ext]
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
        New-JsonResponse -Response $res -StatusCode 200 -Body @{
          config = $cfg; tracking = (Get-AllTracking)
          paths = @{ root = $RootDir; vault = $EvidenceDir; templates = $TemplatesDir }
        }
      }
      elseif ($method -eq 'GET' -and $path -eq '/api/config') {
        New-JsonResponse -Response $res -StatusCode 200 -Body (Get-Config)
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

          if ($process -ne 'NPI' -and $process -ne 'ECN') {
            $rejections += @{ row = $rowNo; reason = ("process must be NPI or ECN (got '" + (& $get 'process') + "')") }; continue
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
        if (-not $relPath -or -not $full.StartsWith($vaultFull, [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $full -PathType Leaf)) {
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
        $stdName = Get-StandardFileName -DocType $body.docType -Model $body.family -WvnId $body.wvnId `
                     -WnbId $body.wnbId -Description $body.description -OriginalName $original
        $saved = Save-Evidence -DocType $body.docType -Family $body.family -PartId $body.partId -FileName $stdName -Bytes $bytes
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
          try { $listener.Stop() } catch { }
          try { $mutex.ReleaseMutex() } catch { }
          try { $mutex.Dispose() } catch { }
          Write-Log 'Stopped by user request.'
          [System.Environment]::Exit(0)
        }
      }
      elseif ($method -eq 'POST' -and $path -eq '/api/filename/preview') {
        # lets the browser show the name before anything is written
        $body = Read-JsonBody -Request $req
        $n = Get-StandardFileName -DocType $body.docType -Model $body.family -WvnId $body.wvnId `
               -WnbId $body.wnbId -Description $body.description -OriginalName ([string]$body.fileName)
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
          $manifest.Add(('Step' + "`t" + 'Document' + "`t" + 'File or link' + "`t" + 'Filed by' + "`t" + 'Approved' + "`t" + 'SHA-256'))
          $copied = 0; $missing = 0; $links = 0
          foreach ($r in $rows) {
            if ([string]$r.kind -eq 'link') {
              $links++
              $manifest.Add(($r.step_key + "`t" + $r.doc_code + "`t" + '[link] ' + $r.link_url + "`t" + $r.uploaded_by + "`t" + $r.approved + "`t"))
              continue
            }
            $src = [string]$r.file_path
            if ($src -and (Test-Path -LiteralPath $src -PathType Leaf)) {
              $sub = Join-Path $stage (ConvertTo-NamePart $r.step_key)
              if (-not (Test-Path -LiteralPath $sub)) { New-Item -ItemType Directory -Path $sub -Force | Out-Null }
              $dest = Join-Path $sub ([System.IO.Path]::GetFileName($src))
              if (-not (Test-Path -LiteralPath $dest)) { Copy-Item -LiteralPath $src -Destination $dest -Force }
              $copied++
              $manifest.Add(($r.step_key + "`t" + $r.doc_code + "`t" + [System.IO.Path]::GetFileName($src) + "`t" + $r.uploaded_by + "`t" + $r.approved + "`t" + $r.sha256))
            } else {
              $missing++
              $manifest.Add(($r.step_key + "`t" + $r.doc_code + "`t" + '*** FILE NOT FOUND: ' + $src + "`t" + $r.uploaded_by + "`t" + $r.approved + "`t" + $r.sha256))
            }
          }
          $manifest.Add('')
          $manifest.Add(('Files included: ' + $copied + '   links cited: ' + $links + '   missing from disk: ' + $missing))
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

          } finally {
            $archive.Dispose()
          }

          $xlsxBytes = [System.IO.File]::ReadAllBytes($tempPath)
          $savedXlsx = Save-Evidence -DocType 'LFI' -Family $family -PartId '' -FileName "${stem}.xlsx" -Bytes $xlsxBytes

          $savedImages = @()
          if ($images) {
            for ($imgIdx = 0; $imgIdx -lt $images.Count; $imgIdx++) {
              $img = $images[$imgIdx]
              $imgName = [string]$img.name
              $imgData = [string]$img.data
              $base64 = ''
              if ($imgData -match ';base64,(.+)$') { $base64 = $Matches[1] } else { $base64 = $imgData }
              $imgBytes = [System.Convert]::FromBase64String($base64)
              $ext = [System.IO.Path]::GetExtension($imgName)
              if (-not $ext) { $ext = '.png' }
              $imgFileName = "${stem}_$($imgIdx+1)$ext"
              $imgSaved = Save-Evidence -DocType 'LFI' -Family $family -PartId '' -FileName $imgFileName -Bytes $imgBytes
              $savedImages += @{ fileName = $imgSaved.fileName; path = $imgSaved.path }
            }
          }

          Add-StoreRow -Store 'lb_issues' -IdField 'issue_id' -Row @{
            project_id  = $projectId
            step_key    = $stepKey
            raised_utc  = (Get-Date).ToUniversalTime().ToString('o')
            raised_by   = $raisedBy
            category    = 'LFI'
            description = $title
            owner       = ''
            status      = 'Open'
            severity    = $severity
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
                $typeKey     = [string]$req.QueryString['type']
                $famFilter   = [string]$req.QueryString['fam']
                $modelFilter = [string]$req.QueryString['model']
                $startFilter = [string]$req.QueryString['start']
                $endFilter   = [string]$req.QueryString['end']

                # Each report names the sheet it writes to. The three
                # RANKED_COLORS workbooks and LL_info all keep their data on
                # sheet2 with a formatted Dashboard on sheet1; the trial report
                # template has ONE sheet and it is the printed form, so that
                # one appends under the form instead of replacing it.
                $templateMap = @{
                  'lfi'      = @{ file = 'Template_EPM_Issue_Analytics_RANKED_COLORS.xlsx';  sheet = 'xl/worksheets/sheet2.xml'; append = $false }
                  'transfer' = @{ file = 'Template_ProjectTransfer_Report_RANKED_COLORS.xlsx'; sheet = 'xl/worksheets/sheet2.xml'; append = $false }
                  'kpi'      = @{ file = 'Template_KPI_Report_RANKED_COLORS.xlsx';           sheet = 'xl/worksheets/sheet2.xml'; append = $false }
                  'll'       = @{ file = 'LL_info.xlsx';                                     sheet = 'xl/worksheets/sheet2.xml'; append = $false; unhideSheet = 'List Issue' }
                  'trial'    = @{ file = 'NPI_Trial_Report_Template.xlsx';                   sheet = 'xl/worksheets/sheet1.xml'; append = $true }
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

                      # Appended rows start past the template's own last row;
                      # reusing an existing r= makes Excel repair the file. The
                      # +1 leaves one blank row between the form and the
                      # appended block so they do not read as one table.
                      $rowOffset = 0
                      if ($appendMode) { $rowOffset = (Get-SheetMaxRow -SheetXml $existingSheetXml) + 1 }

                      # Build row XML
                      $rowsXml = New-Object System.Collections.Generic.List[string]
                      for ($ri = 0; $ri -lt $data.Count; $ri++) {
                        $rowsXml.Add((New-ReportRowXml -Values $data[$ri] -RowNum ($rowOffset + $ri + 1) -Ns $ns))
                      }

                      # Replace (or extend) sheetData content
                      $newSheetXml = New-ReportSheetXml -Existing $existingSheetXml -RowsXml $rowsXml.ToArray() -Ns $ns -Append:$appendMode

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
