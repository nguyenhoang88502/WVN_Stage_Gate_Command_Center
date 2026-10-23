# v12.1 hidden start + desktop shortcut, on an ISOLATED copy of this repo.
#   powershell -ExecutionPolicy Bypass -File tests\v12_1\test_silent_launch.ps1
# Copies the tracked app files to %TEMP%, gives the copy its own mutex name,
# runs the real Open_WVN_NPI_Command_Center.cmd and the real shortcut it makes
# (ports 8093/8094, never 8080-8082), and checks that no console or terminal
# window appears. The shortcut goes to a fake Desktop inside the copy - the
# real Desktop is never touched. Prints PASS/FAIL lines and a RESULT line.
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$script:pass = 0; $script:fail = 0
function Check([string]$name, [bool]$ok, [string]$detail = '') {
  if ($ok) { $script:pass++; Write-Output ('PASS ' + $name) } else { $script:fail++; Write-Output ('FAIL ' + $name + '  ' + $detail) }
}
Add-Type @'
using System; using System.Runtime.InteropServices;
public static class SilentProbe {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  public static int Visible(uint pid) { int n = 0; EnumWindows((h, l) => { uint p; GetWindowThreadProcessId(h, out p); if (p == pid && IsWindowVisible(h)) n++; return true; }, IntPtr.Zero); return n; }
}
'@

# ---- isolated copy -----------------------------------------------------------
$root = Join-Path $env:TEMP ('wvn_silent_' + [guid]::NewGuid().ToString('N').Substring(0, 8))
$app = Join-Path $root 'app'
Push-Location $repo
$files = @(git ls-files -co --exclude-standard -- system Open_WVN_NPI_Command_Center.cmd Stop_Server.cmd)
Pop-Location
foreach ($f in $files) {
  if ($f -like 'system/auth/*' -or $f -like 'system/logs/*' -or $f -like 'system/tracking/journal/*') { continue }
  $src = Join-Path $repo $f
  if (-not (Test-Path -LiteralPath $src -PathType Leaf)) { continue }
  $dst = Join-Path $app $f
  New-Item -ItemType Directory -Path (Split-Path -Parent $dst) -Force | Out-Null
  Copy-Item -LiteralPath $src -Destination $dst
}
New-Item -ItemType Directory -Path (Join-Path $root 'NPI_EPM_Documents_Control') -Force | Out-Null
$lp = Join-Path $app 'system\launcher.ps1'
$txt = [System.IO.File]::ReadAllText($lp)
$txt = $txt.Replace('Global\WVN_NPI_EPM_StageGate_SingleInstance', 'Global\WVN_NPI_EPM_StageGate_SingleInstance_SILENTTEST')
[System.IO.File]::WriteAllText($lp, $txt, (New-Object System.Text.UTF8Encoding($true)))
$desk = Join-Path $root 'FakeDesktop'
$lnkPath = Join-Path $desk 'WVN Stage Gate Command Center.lnk'
$cmdFile = Join-Path $app 'Open_WVN_NPI_Command_Center.cmd'
$extra = '-NoBrowser -Port 8094 -Quiet'

function Wait-Port([int]$port, [bool]$up) {
  for ($i = 0; $i -lt 60; $i++) {
    $ok = $false
    try { Invoke-RestMethod ('http://127.0.0.1:' + $port + '/api/auth/status') -TimeoutSec 2 | Out-Null; $ok = $true } catch { }
    if ($ok -eq $up) { return $true }
    Start-Sleep -Milliseconds 500
  }
  return $false
}
# every process started from this copy, plus the console hosts they run in
function Get-AppTree {
  $all = @(Get-CimInstance Win32_Process)
  $mine = @($all | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($root) })
  $ids = @{}; foreach ($p in $mine) { $ids[[int]$p.ProcessId] = $p.Name; $ids[[int]$p.ParentProcessId] = 'parent' }
  foreach ($p in $all) { if ($ids.ContainsKey([int]$p.ParentProcessId) -and $p.Name -eq 'conhost.exe') { $ids[[int]$p.ProcessId] = $p.Name } }
  return $ids
}
function Get-VisibleCount {
  $n = 0
  foreach ($id in (Get-AppTree).Keys) { if ($id -gt 4) { $n += [SilentProbe]::Visible([uint32]$id) } }
  return $n
}
function Start-ViaCmd {
  # exactly what a double-click does, plus the test-only switches
  $argLine = '/c ""' + $cmdFile + '" -NoBrowser -Port 8093 -Quiet -ShortcutDir "' + $desk + '" -ShortcutExtraArgs:"' + $extra + '""'
  $p = Start-Process cmd.exe -ArgumentList $argLine -PassThru -WindowStyle Hidden
  $p.WaitForExit(15000) | Out-Null
  return $p
}
function Stop-App([int]$port) { & (Join-Path $app 'system\Stop-CommandCenter.ps1') -Ports $port -Quiet }
$termBefore = @(Get-Process WindowsTerminal -ErrorAction SilentlyContinue).Count

try {
  # ---- 1. first run from the .cmd --------------------------------------------
  $c = Start-ViaCmd
  Check '1 the .cmd window hands over and closes at once' ($c.HasExited -and $c.ExitCode -eq 0) ('exit=' + $c.ExitCode)
  Check '1 the server comes up' (Wait-Port 8093 $true)
  Start-Sleep -Seconds 2
  $vis = Get-VisibleCount
  Check '1 no visible console window while the server runs' ($vis -eq 0) ('visible=' + $vis)
  Check '1 no Windows Terminal window opened' (@(Get-Process WindowsTerminal -ErrorAction SilentlyContinue).Count -eq $termBefore)
  $tree = Get-AppTree
  Check '1 the server runs under a headless console host' (@(Get-CimInstance Win32_Process | Where-Object { $tree.ContainsKey([int]$_.ProcessId) -and $_.Name -eq 'conhost.exe' -and $_.CommandLine -like '*--headless*' }).Count -ge 1)
  Check '1 desktop shortcut created' (Test-Path -LiteralPath $lnkPath)
  $sh = New-Object -ComObject WScript.Shell
  $lnk = $sh.CreateShortcut($lnkPath)
  Check '1 shortcut runs conhost --headless' ($lnk.TargetPath -like '*\System32\conhost.exe' -and $lnk.Arguments -like '--headless *powershell.exe*') ($lnk.TargetPath + ' ' + $lnk.Arguments)
  Check '1 shortcut points at this copy, written relative to %USERPROFILE%' ($lnk.Arguments -like "*`$env:USERPROFILE*" -and $lnk.Arguments -like '*Start-CommandCenter.ps1*' -and $lnk.Arguments -like '*-FromShortcut*') $lnk.Arguments
  $iconPath = [Environment]::ExpandEnvironmentVariables(($lnk.IconLocation -split ',')[0])
  Check '1 shortcut uses the app icon' ((Test-Path -LiteralPath $iconPath) -and $iconPath -like '*\system\assets\wvn_stage_gate.ico') $lnk.IconLocation
  $fav = Invoke-WebRequest 'http://127.0.0.1:8093/favicon.ico' -UseBasicParsing
  Check '1 the same icon is the browser favicon (no sign-in needed)' ($fav.StatusCode -eq 200 -and $fav.Headers['Content-Type'] -eq 'image/x-icon' -and $fav.RawContentLength -eq (Get-Item -LiteralPath $iconPath).Length)
  # The server must really WORK when started this way, not just answer. A
  # first sign-in with the bundled PIN, a password change and an authenticated
  # read all write files through scriptblock closures - which broke when the
  # launcher was called from a child scope instead of as a top-level script.
  $pin = [string]((Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $app 'system\config.json')) | ConvertFrom-Json).admin_pin
  $web1 = $null
  $li = Invoke-RestMethod 'http://127.0.0.1:8093/api/auth/login' -Method Post -ContentType 'application/json' -Body (@{ username = 'admin'; password = $pin } | ConvertTo-Json -Compress) -SessionVariable web1
  Check '1 first admin sign-in with the bundled PIN works (the account file is written)' ($li.must_change -eq $true) ($li | ConvertTo-Json -Compress)
  $cp = Invoke-RestMethod 'http://127.0.0.1:8093/api/auth/change-password' -Method Post -ContentType 'application/json' -WebSession $web1 -Body (@{ current = $pin; new = 'Silent-test-2026' } | ConvertTo-Json -Compress)
  Check '1 the password change is saved' ($cp.ok -eq $true)
  $dat = Invoke-RestMethod 'http://127.0.0.1:8093/api/data' -WebSession $web1
  Check '1 data is readable after sign-in' ($dat.session.user -eq 'admin' -and $null -eq $dat.config.admin_pin)
  Check '1 config.json was rewritten without the old PIN (Save-Config works)' (-not ((Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $app 'system\config.json')) -match '"admin_pin"'))
  $adminFile = @(Get-ChildItem -LiteralPath (Join-Path $app 'system\auth') -Filter 'u_admin_*.json')
  Check '1 the admin account file is not empty' ($adminFile.Count -eq 1 -and $adminFile[0].Length -gt 100) ($adminFile | ForEach-Object Length)
  $r = Stop-App 8093
  Check '1 Stop-CommandCenter stops it without a window' ($r.stopped -and (Wait-Port 8093 $false))

  # ---- 2. second run: an identical shortcut is left alone --------------------
  $stamp = (Get-Item -LiteralPath $lnkPath).LastWriteTimeUtc
  Start-Sleep -Milliseconds 1200
  Start-ViaCmd | Out-Null
  Check '2 second run starts again' (Wait-Port 8093 $true)
  Check '2 an up-to-date shortcut is not rewritten' ((Get-Item -LiteralPath $lnkPath).LastWriteTimeUtc -eq $stamp)
  Stop-App 8093 | Out-Null; Wait-Port 8093 $false | Out-Null

  # ---- 3. a broken shortcut (moved folder, other PC) is repaired -------------
  $good = $lnk.Arguments
  $bad = $sh.CreateShortcut($lnkPath); $bad.Arguments = '--headless powershell.exe -File "C:\nowhere\Start-CommandCenter.ps1"'; $bad.Save()
  Start-ViaCmd | Out-Null
  Check '3 run after the folder "moved" starts' (Wait-Port 8093 $true)
  Check '3 the stale shortcut is repaired' ($sh.CreateShortcut($lnkPath).Arguments -eq $good)
  Stop-App 8093 | Out-Null; Wait-Port 8093 $false | Out-Null

  # ---- 4. starting from the desktop shortcut ---------------------------------
  $logDir = Join-Path $app 'system\logs'
  Start-Process -FilePath $lnkPath
  Check '4 the shortcut starts the server' (Wait-Port 8094 $true)
  Start-Sleep -Seconds 2
  $vis = Get-VisibleCount
  Check '4 no visible window at all from the shortcut' ($vis -eq 0) ('visible=' + $vis)
  Check '4 still no Windows Terminal' (@(Get-Process WindowsTerminal -ErrorAction SilentlyContinue).Count -eq $termBefore)
  $startLog = @(Get-ChildItem -LiteralPath $logDir -Filter 'start_*.log' | Get-Content -Encoding UTF8)
  Check '4 the start log records a shortcut start that skipped first-run work' (($startLog | Where-Object { $_ -match 'start \(desktop shortcut\)' }).Count -ge 1)
  Check '4 the launcher log is written as usual' (@(Get-ChildItem -LiteralPath $logDir -Filter 'launcher_*.log').Count -ge 1)
  $r = Stop-App 8094
  Check '4 stopped' ($r.stopped -and (Wait-Port 8094 $false))
  $r = Stop-App 8094
  Check '5 Stop-CommandCenter reports when nothing is running' (-not $r.stopped)
} finally {
  foreach ($p in 8093, 8094) { try { Stop-App $p | Out-Null } catch { } }
  Start-Sleep -Seconds 1
  Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}
Write-Output ("RESULT pass=$($script:pass) fail=$($script:fail)")
