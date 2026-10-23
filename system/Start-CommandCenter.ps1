#requires -version 3
<#
  Start-CommandCenter.ps1 — the one way the app is started (v12.1).

  Runs inside a HEADLESS console host (conhost.exe --headless), started by
  Open_WVN_NPI_Command_Center.cmd or by the desktop shortcut, so there is no
  PowerShell window at all - not even a minimised one. -WindowStyle Hidden on
  its own was not enough: on Windows 11 the default terminal is Windows
  Terminal, which takes the console over before PowerShell can hide it and
  leaves a visible terminal window open for as long as the server runs.

  First run on a PC (from the .cmd in the synced SharePoint folder):
    1. clears the "downloaded from the internet" mark on the app folder
    2. creates a desktop shortcut for THIS PC, pointing at wherever OneDrive
       synced the folder here, with the app's own icon
    3. starts the server (launcher.ps1) in this same hidden process
  From the desktop shortcut (-FromShortcut) only step 3 runs.

  Nothing is ever shown in a console. Problems the person must know about
  (the server could not start) come up as an ordinary message box; the
  details are in system\logs.
#>
[CmdletBinding()]
param(
  # set by the desktop shortcut: skip the first-run work
  [switch]$FromShortcut,
  # passed through to launcher.ps1
  [int]$Port = 8080,
  [switch]$NoBrowser,
  [string]$WriterId = '',
  # tests only: put the shortcut here instead of the Desktop, bake extra
  # arguments into it, and never open a message box
  [string]$ShortcutDir = '',
  [string]$ShortcutExtraArgs = '',
  [switch]$Quiet
)

$ErrorActionPreference = 'Stop'
$SystemDir = $PSScriptRoot
if (-not $SystemDir) { $SystemDir = Split-Path -Parent $MyInvocation.MyCommand.Path }
$RootDir = Split-Path -Parent $SystemDir
$AppTitle = 'WVN Stage Gate Command Center'
$ShortcutFile = $AppTitle + '.lnk'
$IconFile = Join-Path $SystemDir 'assets\wvn_stage_gate.ico'

function Write-StartLog { param([string]$Message)
  try {
    $dir = Join-Path $SystemDir 'logs'
    if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    $who = ([string]$env:COMPUTERNAME + '_' + [string]$env:USERNAME) -replace '[^A-Za-z0-9_-]', '_'
    Add-Content -LiteralPath (Join-Path $dir ('start_' + $who + '.log')) -Value ('[' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '] ' + $Message) -Encoding UTF8
  } catch { }
}
function Show-Message { param([string]$Text, [string]$Icon = 'Error')
  Write-StartLog ('message: ' + $Text)
  if ($Quiet) { return }
  try {
    Add-Type -AssemblyName System.Windows.Forms
    [void][System.Windows.Forms.MessageBox]::Show($Text, $AppTitle, [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::$Icon)
  } catch { }
}

# A path inside the user's profile is written relative to %USERPROFILE%, so a
# shortcut that OneDrive syncs to the person's other PCs (Desktop folder
# backup) still works there even when the Windows user name differs.
function Get-ProfileRelative { param([string]$Path)
  $prof = ([Environment]::GetFolderPath('UserProfile')).TrimEnd('\')
  if ($prof -and $Path.StartsWith($prof + '\', [StringComparison]::OrdinalIgnoreCase)) { return $Path.Substring($prof.Length + 1) }
  return $null
}

# What the desktop shortcut runs. conhost.exe --headless gives PowerShell a
# console that has no window (Windows 10 1809 and later); without it the
# shortcut falls back to a hidden, minimised PowerShell.
function Get-ShortcutSpec {
  $ps = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $conhost = Join-Path $env:SystemRoot 'System32\conhost.exe'
  $me = Join-Path $SystemDir 'Start-CommandCenter.ps1'
  $extra = if ($ShortcutExtraArgs) { ' ' + $ShortcutExtraArgs } else { '' }
  $rel = Get-ProfileRelative $me
  if ($rel) {
    $cmd = "& (Join-Path `$env:USERPROFILE '" + $rel.Replace("'", "''") + "') -FromShortcut" + $extra
    $psArgs = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "' + $cmd + '"'
  } else {
    $psArgs = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $me + '" -FromShortcut' + $extra
  }
  $iconRel = Get-ProfileRelative $IconFile
  $spec = @{
    target   = $ps
    args     = $psArgs
    icon     = if ($iconRel) { '%USERPROFILE%\' + $iconRel + ',0' } else { $IconFile + ',0' }
    workdir  = '%USERPROFILE%'
    style    = 7   # minimised: only matters for the fallback without conhost
  }
  if (Test-Path -LiteralPath $conhost) { $spec.target = $conhost; $spec.args = '--headless "' + $ps + '" ' + $psArgs }
  return $spec
}

# Creates the desktop shortcut, or repairs it when it no longer matches this
# PC (the folder moved, a newer version changed how it starts, or it came
# from another PC through OneDrive with a path that does not exist here).
# An identical shortcut is left untouched, so two PCs syncing the same
# Desktop never rewrite each other's file.
function Install-DesktopShortcut {
  $desk = if ($ShortcutDir) { $ShortcutDir } else { [Environment]::GetFolderPath('Desktop') }
  if (-not $desk) { Write-StartLog 'no Desktop folder - shortcut skipped'; return 'skipped' }
  if (-not (Test-Path -LiteralPath $desk)) { New-Item -ItemType Directory -Path $desk -Force | Out-Null }
  $path = Join-Path $desk $ShortcutFile
  $want = Get-ShortcutSpec
  $sh = New-Object -ComObject WScript.Shell
  $state = 'created'
  if (Test-Path -LiteralPath $path) {
    $have = $sh.CreateShortcut($path)
    # A saved shortcut reports its icon path with %USERPROFILE% still in it,
    # which is what keeps it valid on the person's other PCs; accept either
    # form so an identical shortcut is recognised as identical.
    $iconOk = ($have.IconLocation -eq $want.icon) -or ($have.IconLocation -eq [Environment]::ExpandEnvironmentVariables($want.icon))
    if ($have.TargetPath -eq $want.target -and $have.Arguments -eq $want.args -and $iconOk) { return 'unchanged' }
    $state = 'updated'
  }
  $lnk = $sh.CreateShortcut($path)
  $lnk.TargetPath = $want.target
  $lnk.Arguments = $want.args
  $lnk.WorkingDirectory = $want.workdir
  $lnk.IconLocation = $want.icon
  $lnk.WindowStyle = $want.style
  $lnk.Description = 'WAHL Vietnam - NPI & ECN Stage Gate Command Center (' + $RootDir + ')'
  $lnk.Save()
  Write-StartLog ('desktop shortcut ' + $state + ': ' + $path + ' -> ' + $RootDir)
  return $state
}

Write-StartLog ('start (' + $(if ($FromShortcut) { 'desktop shortcut' } else { 'Open_WVN_NPI_Command_Center.cmd' }) + ') in ' + $RootDir)

if (-not $FromShortcut) {
  try {
    Get-ChildItem -LiteralPath $RootDir -Recurse -File -ErrorAction SilentlyContinue | Unblock-File -ErrorAction SilentlyContinue
  } catch { Write-StartLog ('unblock: ' + $_.Exception.Message) }
  try { [void](Install-DesktopShortcut) }
  catch { Write-StartLog ('desktop shortcut failed: ' + $_.Exception.Message) }   # never a reason not to start
}

$launcher = Join-Path $SystemDir 'launcher.ps1'
$la = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $launcher + '" -Port ' + $Port
if ($NoBrowser) { $la += ' -NoBrowser' }
if ($WriterId) { $la += ' -WriterId "' + $WriterId + '"' }
$psExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
try {
  # The launcher runs as its OWN PowerShell process, on this same hidden
  # console (-NoNewWindow = no new console, so no window). It must not be
  # called with & or dot-sourced from here: it relies on running as a
  # top-level script (-File), and from a child scope every
  # scriptblock.GetNewClosure() in it - every save - fails with "Write-AllText
  # is not recognized".
  $child = Start-Process -FilePath $psExe -ArgumentList $la -NoNewWindow -Wait -PassThru
  if ($child.ExitCode -eq 1) {
    Show-Message ('Không khởi động được máy chủ: các cổng ' + $Port + '-' + ($Port + 2) + ' đều đang bận.' + "`n" +
                  'The server could not start: ports ' + $Port + '-' + ($Port + 2) + ' are all in use.' + "`n`n" +
                  'Chi tiết / details: ' + (Join-Path $SystemDir 'logs'))
  }
} catch {
  Write-StartLog ('launcher failed: ' + $_.Exception.Message)
  Show-Message ('Không khởi động được ứng dụng. / The app could not start.' + "`n`n" + $_.Exception.Message + "`n`n" +
                'Chi tiết / details: ' + (Join-Path $SystemDir 'logs'))
}
