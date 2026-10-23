# Two-PC journal storage tests (v11). Drives the REAL launcher over HTTP as
# two simulated PCs (-WriterId PC_A / PC_B) against a COPY of the app, hiding
# one PC's journal from the other to reproduce 'not yet synced'.
#
# Run (never against the live folder - it writes journals and vault files):
#   1. copy system\ to <tmp>\app\system and create <tmp>\NPI_EPM_Documents_Control
#   2. delete <tmp>\app\system\tracking\journal if present
#   3. powershell -File tests\storage\test_storage.ps1 -Root <tmp>
# Uses port 8090; stop any running Command Center first (machine-wide mutex).

param([string]$Root)
$ErrorActionPreference = 'Stop'
$sys = Join-Path $Root 'app\system'
$trk = Join-Path $sys 'tracking'
# v12.2: the journals live in the vault (<vault>\_vault\journal), not in tracking\
$jr  = Join-Path $Root 'NPI_EPM_Documents_Control\_vault\journal'
$base = 'http://localhost:8090'
$script:fail = 0; $script:pass = 0
function Check([string]$name, [bool]$ok, [string]$detail = '') {
  if ($ok) { $script:pass++; Write-Output ('PASS ' + $name) } else { $script:fail++; Write-Output ('FAIL ' + $name + '  ' + $detail) }
}
function Start-App([string]$writer) {
  $p = Start-Process powershell -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $sys 'launcher.ps1'),'-NoBrowser','-Port','8090','-WriterId',$writer) -PassThru -WindowStyle Hidden
  for ($i = 0; $i -lt 60; $i++) { try { Invoke-RestMethod "$base/api/auth/status" -TimeoutSec 2 | Out-Null; Enter-App; return $p } catch { Start-Sleep -Milliseconds 500 } }
  throw "server $writer did not start"
}
# v12: every /api/* call needs a session, and a session lives in the launcher
# process - so each (re)start signs in again as admin. $script:ws carries the
# cookie; Post and GetData send it.
$TestAdminPw = 'Test-admin-2026'
function Enter-App {
  $body = @{ username = 'admin'; password = $TestAdminPw } | ConvertTo-Json -Compress
  Invoke-RestMethod "$base/api/auth/login" -Method Post -ContentType 'application/json; charset=utf-8' -Body $body -SessionVariable ws | Out-Null
  $script:ws = $ws
}
function Stop-App($p) {
  try { Invoke-RestMethod "$base/api/shutdown" -Method Post -ContentType 'application/json' -Body '{"user":"test"}' | Out-Null } catch { }
  $p.WaitForExit(15000) | Out-Null
  if (-not $p.HasExited) { $p.Kill() }
  Start-Sleep -Milliseconds 400
}
function Post($path, $obj) { Invoke-RestMethod "$base$path" -Method Post -ContentType 'application/json; charset=utf-8' -WebSession $script:ws -Body ([System.Text.Encoding]::UTF8.GetBytes(($obj | ConvertTo-Json -Depth 8 -Compress))) }
function GetData() { Invoke-RestMethod "$base/api/data" -WebSession $script:ws }
function Hash($f) { (Get-FileHash -LiteralPath $f -Algorithm SHA256).Hash }
function CsvRows($store) { @(Import-Csv -LiteralPath (Join-Path $trk ($store + '.csv')) -Encoding UTF8) }

# ---------------- v12 setup: give the copy's admin a known password
# The first admin sign-in uses the old PIN from this copy's config.json and
# must replace it; doing so removes admin_pin from config.json. That is a
# one-time, deliberate edit, so it happens HERE, before the baselines below
# are taken - T7 then still proves that merely starting and stopping the app
# never touches config.json. The journal this setup run wrote (two audit
# lines) is removed again so T1 starts from the same clean state as before.
$pin = [string]((Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $sys 'config.json')) | ConvertFrom-Json).admin_pin
if ($pin) {
  $sp = Start-Process powershell -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $sys 'launcher.ps1'),'-NoBrowser','-Port','8090','-WriterId','PC_A') -PassThru -WindowStyle Hidden
  for ($i = 0; $i -lt 60; $i++) { try { Invoke-RestMethod "$base/api/auth/status" -TimeoutSec 2 | Out-Null; break } catch { Start-Sleep -Milliseconds 500 } }
  Invoke-RestMethod "$base/api/auth/login" -Method Post -ContentType 'application/json; charset=utf-8' -Body (@{ username = 'admin'; password = $pin } | ConvertTo-Json -Compress) -SessionVariable sws | Out-Null
  Invoke-RestMethod "$base/api/auth/change-password" -Method Post -ContentType 'application/json; charset=utf-8' -WebSession $sws -Body (@{ current = $pin; new = $TestAdminPw } | ConvertTo-Json -Compress) | Out-Null
  Stop-App $sp
  if (Test-Path -LiteralPath $jr) { Remove-Item -LiteralPath $jr -Recurse -Force }
  Remove-Item -LiteralPath (Join-Path $sys 'logs\launcher_PC_A.log') -Force -ErrorAction SilentlyContinue
}

$baseHashes = @{}; foreach ($f in Get-ChildItem $trk -Filter *.csv) { $baseHashes[$f.Name] = Hash $f.FullName }
$cfgHash = Hash (Join-Path $sys 'config.json')

# ---------------- T1 parity as PC_A
$p = Start-App 'PC_A'
$d = GetData
foreach ($f in Get-ChildItem $trk -Filter *.csv) {
  $s = $f.BaseName
  $n = (CsvRows $s).Count
  # v12: a sign-in writes one Auth_Login audit line, so those are not part of
  # the base file being compared against.
  $apiRows = @($d.tracking.$s | Where-Object { -not ($s -eq 'lb_audit' -and $_.action -like 'Auth_*') })
  Check "T1 parity $s ($n rows)" ($apiRows.Count -eq $n) ("api=" + $apiRows.Count)
}
# evidenceFor-equivalent: last real row per key must be the ONLY active one
$raw = CsvRows 'lb_deliverables'
$expectActive = @{}
foreach ($r in $raw) { if ($r.file_name -or $r.link_url -or $r.file_path) { $expectActive[$r.project_id + '|' + $r.step_key + '|' + $r.doc_code] = $r.deliverable_id } }
$gotActive = @{}; $dupActive = 0
foreach ($r in $d.tracking.lb_deliverables) { if ($r.is_active -eq 'YES') { $k = $r.project_id + '|' + $r.step_key + '|' + $r.doc_code; if ($gotActive.ContainsKey($k)) { $dupActive++ }; $gotActive[$k] = $r.deliverable_id } }
$mismatch = @($expectActive.Keys | Where-Object { $gotActive[$_] -ne $expectActive[$_] })
Check "T1 active revision == today's last-row-wins for all $($expectActive.Count) documents" ($mismatch.Count -eq 0 -and $gotActive.Count -eq $expectActive.Count) ($mismatch -join ',')
Check 'T1 no document has two active revisions' ($dupActive -eq 0)
$markers = @($d.tracking.lb_deliverables | Where-Object { -not ($_.file_name -or $_.link_url -or $_.file_path) })
Check "T1 $($markers.Count) marker rows carry no revision number" (@($markers | Where-Object { $_.revision_no }).Count -eq 0)
Check 'T1 /api/data reports journal storage + writer' ($d.storage.mode -eq 'journal' -and $d.storage.writer -eq 'PC_A')
Check 'T1 deployment_path is runtime, not the stored one' ((Get-Item -LiteralPath $d.config.system_info.deployment_path).FullName -eq (Get-Item -LiteralPath (Join-Path $Root 'app')).FullName) ($d.config.system_info.deployment_path + ' vs ' + (Join-Path $Root 'app'))

# ---------------- T2 upload + two revisions as PC_A
$proj = $d.tracking.lb_projects[0]
$pid0 = $proj.project_id; $sk = 'TEST-S1'; $doc = 'PFMEA'
$b64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes('revision one'))
$up1 = Post '/api/upload' @{ fileName = 'pfmea.xlsx'; contentBase64 = $b64; docType = $doc; family = $proj.family; wvnId = ''; wnbId = ''; description = 'PFMEA'; partId = '' }
Check 'T2 stored file name ends in a version (v12.3), not a hash' ($up1.fileName -match '_v1\.xlsx$') $up1.fileName
Check 'T2 file landed in the vault' (Test-Path -LiteralPath $up1.path)
$r1 = Post '/api/action' @{ store = 'lb_deliverables'; row = @{ project_id = $pid0; step_key = $sk; doc_code = $doc; file_name = $up1.fileName; file_path = $up1.path; sha256 = $up1.sha256; status = 'Filed'; uploaded_by = 'alice'; uploaded_utc = '2026-09-18T01:00:00.000Z'; kind = 'file' } }
$b64b = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes('revision two'))
$up2 = Post '/api/upload' @{ fileName = 'pfmea.xlsx'; contentBase64 = $b64b; docType = $doc; family = $proj.family; wvnId = ''; wnbId = ''; description = 'PFMEA'; partId = '' }
Check 'T2 second revision gets a different file (no overwrite)' ($up2.path -ne $up1.path -and (Test-Path -LiteralPath $up1.path))
$r2 = Post '/api/action' @{ store = 'lb_deliverables'; row = @{ project_id = $pid0; step_key = $sk; doc_code = $doc; file_name = $up2.fileName; file_path = $up2.path; sha256 = $up2.sha256; status = 'Filed'; uploaded_by = 'alice'; uploaded_utc = '2026-09-18T02:00:00.000Z'; kind = 'file'; change_reason = 'RPN update' } }
Check 'T2 new IDs carry the writer tag' ($r1.deliverable_id -match '^DEL-\d{4}-[0-9A-F]{3}$') $r1.deliverable_id
$d = GetData
$revs = @($d.tracking.lb_deliverables | Where-Object { $_.project_id -eq $pid0 -and $_.step_key -eq $sk -and $_.doc_code -eq $doc })
Check 'T2 two revisions numbered 1,2' ((($revs | ForEach-Object revision_no) -join ',') -eq '1,2')
Check 'T2 only rev 2 active; rev 1 superseded at rev 2 upload time' ($revs[1].is_active -eq 'YES' -and $revs[0].is_active -eq 'NO' -and $revs[0].superseded_utc -eq '2026-09-18T02:00:00.000Z')
Check 'T2 change_reason persisted' ($revs[1].change_reason -eq 'RPN update')
Check 'T2 path read back absolute' ($revs[1].file_path -eq $up2.path) $revs[1].file_path
$jline = Get-Content -LiteralPath (Join-Path $jr 'PC_A\lb_deliverables.csv') -Encoding UTF8 | Select-Object -Last 1
Check 'T2 path stored vault-relative in the journal' ($jline -notmatch [regex]::Escape($Root) -and $jline -match 'PFMEA') $jline

# ---------------- T3 claim (upsert by doc key) as PC_A
Post '/api/action' @{ store = 'lb_deliverables'; row = @{ project_id = $pid0; step_key = $sk; doc_code = $doc; owner_pic = 'alice'; claimed_by = 'alice' }; upsertKeys = @('project_id','step_key','doc_code') } | Out-Null
Stop-App $p

# ---------------- T4 PC_B edits a different field of the same record
$p = Start-App 'PC_B'
Post '/api/action' @{ store = 'lb_deliverables'; row = @{ project_id = $pid0; step_key = $sk; doc_code = $doc; target_week = '2026-W40' }; upsertKeys = @('project_id','step_key','doc_code') } | Out-Null
$d = GetData
$first = @($d.tracking.lb_deliverables | Where-Object { $_.project_id -eq $pid0 -and $_.step_key -eq $sk -and $_.doc_code -eq $doc })[0]
Check 'T4 per-field merge keeps PC_A claim AND PC_B target week' ($first.owner_pic -eq 'alice' -and $first.target_week -eq '2026-W40') ($first | ConvertTo-Json -Compress)
Stop-App $p

# ---------------- T5 offline creation of the same logical record on two PCs
Move-Item (Join-Path $jr 'PC_A') (Join-Path $Root 'hidden_A')
$p = Start-App 'PC_B'
$gB = Post '/api/action' @{ store = 'lb_gates'; row = @{ project_id = $pid0; process = 'NPI'; step_key = 'TEST-G9'; status = 'InProgress'; notes = 'from B' }; upsertKeys = @('project_id','step_key') }
$dB = Post '/api/action' @{ store = 'lb_deliverables'; row = @{ project_id = $pid0; step_key = 'TEST-S2'; doc_code = 'BOM'; file_name = 'b.pdf'; file_path = 'x\b.pdf'; uploaded_by = 'bob'; uploaded_utc = '2026-09-18T03:00:00.000Z' } }
Stop-App $p
Move-Item (Join-Path $jr 'PC_B') (Join-Path $Root 'hidden_B'); Move-Item (Join-Path $Root 'hidden_A') (Join-Path $jr 'PC_A')
$p = Start-App 'PC_A'
$gA = Post '/api/action' @{ store = 'lb_gates'; row = @{ project_id = $pid0; process = 'NPI'; step_key = 'TEST-G9'; status = 'InProgress'; owner_pic = 'alice' }; upsertKeys = @('project_id','step_key') }
$dA = Post '/api/action' @{ store = 'lb_deliverables'; row = @{ project_id = $pid0; step_key = 'TEST-S2'; doc_code = 'BOM'; file_name = 'a.pdf'; file_path = 'x\a.pdf'; uploaded_by = 'alice'; uploaded_utc = '2026-09-18T03:00:05.000Z' } }
Stop-App $p
Move-Item (Join-Path $Root 'hidden_B') (Join-Path $jr 'PC_B')
Check 'T5 same natural key on two unsynced PCs -> same deterministic ID' ($gA.gate_id -eq $gB.gate_id) ($gA.gate_id + ' vs ' + $gB.gate_id)
Check 'T5 concurrent appends on two unsynced PCs -> distinct IDs' ($dA.deliverable_id -ne $dB.deliverable_id) ($dA.deliverable_id + ' vs ' + $dB.deliverable_id)
$p = Start-App 'PC_A'
$d = GetData
$g = @($d.tracking.lb_gates | Where-Object { $_.step_key -eq 'TEST-G9' })
Check 'T5 after sync: ONE gate row holding both edits' ($g.Count -eq 1 -and $g[0].notes -eq 'from B' -and $g[0].owner_pic -eq 'alice') ($g | ConvertTo-Json -Compress)
$b = @($d.tracking.lb_deliverables | Where-Object { $_.step_key -eq 'TEST-S2' })
Check 'T5 after sync: both uploads kept, exactly one active' ($b.Count -eq 2 -and @($b | Where-Object { $_.is_active -eq 'YES' }).Count -eq 1)
Stop-App $p

# ---------------- T8 same field edited on two PCs: the later edit wins
$p = Start-App 'PC_B'
Post '/api/action' @{ store = 'lb_gates'; row = @{ project_id = $pid0; step_key = 'TEST-G9'; status = 'Blocked-by-B' }; upsertKeys = @('project_id','step_key') } | Out-Null
Stop-App $p
$p = Start-App 'PC_A'
Post '/api/action' @{ store = 'lb_gates'; row = @{ project_id = $pid0; step_key = 'TEST-G9'; status = 'Done-by-A' }; upsertKeys = @('project_id','step_key') } | Out-Null
Stop-App $p
$p = Start-App 'PC_B'
$d = GetData
$g = @($d.tracking.lb_gates | Where-Object { $_.step_key -eq 'TEST-G9' })
Check 'T8 same field on two PCs: later edit wins regardless of which journal is read first' ($g.Count -eq 1 -and $g[0].status -eq 'Done-by-A') ($g | ConvertTo-Json -Compress)
Stop-App $p

# ---------------- T6 OneDrive conflict copy of a journal is merged, not lost
$src = Join-Path $jr 'PC_A\lb_issues.csv'
$hdr = (Get-Content -LiteralPath (Join-Path $jr 'PC_A\lb_deliverables.csv') -Encoding UTF8 -TotalCount 1)
$cc = Join-Path $jr 'PC_A\lb_deliverables-LAPTOP9.csv'
$cols = $hdr.Split(',')
$vals = foreach ($c in $cols) { switch ($c) { 'deliverable_id' { 'DEL-9999-ZZZ' } 'project_id' { $pid0 } 'step_key' { 'TEST-S3' } 'doc_code' { 'DWG' } 'file_name' { 'cc.pdf' } '_v_utc' { '2026-09-18T04:00:00.0000000Z' } '_v_writer' { 'PC_A' } '_v_seq' { '1' } '_v_set' { '*' } default { '' } } }
Set-Content -LiteralPath $cc -Value @($hdr, ($vals -join ',')) -Encoding UTF8
$p = Start-App 'PC_A'
$d = GetData
Check 'T6 row that exists only in a conflict copy is visible' (@($d.tracking.lb_deliverables | Where-Object { $_.deliverable_id -eq 'DEL-9999-ZZZ' }).Count -eq 1)
Check 'T6 conflict copy raises a storage warning' (@($d.storage.warnings | Where-Object { $_ -match 'conflict copy' }).Count -ge 1) (($d.storage.warnings) -join ' | ')
Stop-App $p

# ---------------- T7 nothing touched the base files or config.json
$changed = @(Get-ChildItem $trk -Filter *.csv | Where-Object { $baseHashes[$_.Name] -ne (Hash $_.FullName) } | ForEach-Object Name)
Check 'T7 base CSVs untouched by the running app' ($changed.Count -eq 0) ($changed -join ',')
Check 'T7 config.json untouched by startup/shutdown' ((Hash (Join-Path $sys 'config.json')) -eq $cfgHash)
Check 'T7 per-writer log files' ((Test-Path (Join-Path $sys 'logs\launcher_PC_A.log')) -and (Test-Path (Join-Path $sys 'logs\launcher_PC_B.log')))

Write-Output ("RESULT pass=$($script:pass) fail=$($script:fail)")
