#requires -version 3
<#
  Stop-CommandCenter.ps1 — stops this PC's server without a console window
  (v12.1). Started hidden by Stop_Server.cmd; the result is a message box.

  Same graceful path as always: POST /api/shutdown over loopback, tried
  against every port the launcher may have bound, never a process kill.
#>
[CmdletBinding()]
param(
  [int[]]$Ports = @(8080, 8081, 8082),
  # tests only: no message box, result on the pipeline
  [switch]$Quiet
)
$AppTitle = 'WVN Stage Gate Command Center'
$stopped = 0
foreach ($p in $Ports) {
  try {
    $body = @{ user = 'Stop_Server.cmd' } | ConvertTo-Json -Compress
    Invoke-RestMethod -Uri ('http://127.0.0.1:' + $p + '/api/shutdown') -Method Post -ContentType 'application/json' -Body $body -TimeoutSec 3 | Out-Null
    $stopped = $p
    break
  } catch { }
}
if ($stopped) {
  $text = 'Đã dừng ứng dụng trên máy này (cổng ' + $stopped + ').' + "`n" + 'The app has been stopped on this PC (port ' + $stopped + ').'
  $icon = 'Information'
} else {
  $text = 'Ứng dụng không chạy trên máy này.' + "`n" + 'The app is not running on this PC.'
  $icon = 'Warning'
}
if ($Quiet) { return [pscustomobject]@{ stopped = [bool]$stopped; port = $stopped } }
try {
  Add-Type -AssemblyName System.Windows.Forms
  [void][System.Windows.Forms.MessageBox]::Show($text, $AppTitle, [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::$icon)
} catch { }
