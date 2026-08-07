@echo off
setlocal
title WVN NPI ^& ECN Stage Gate - Stop Server

rem Tries the same graceful path as the in-app "Stop Server" button
rem (POST /api/shutdown over loopback) against every port the launcher
rem tries on startup, in order. This is intentionally not a taskkill /
rem Stop-Process against the PID - a forced self-kill was the original bug
rem the app shipped with, and it is exactly what this script exists to avoid.

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ports = 8080,8081,8082;" ^
  "$stopped = $false;" ^
  "foreach ($p in $ports) {" ^
  "  try {" ^
  "    $r = Invoke-RestMethod -Uri ('http://127.0.0.1:' + $p + '/api/shutdown') -Method Post -ContentType 'application/json' -Body (@{ user = 'Stop_WVN_NPI_Command_Center.cmd' } | ConvertTo-Json) -TimeoutSec 3;" ^
  "    Write-Host ('[OK] Server on port ' + $p + ' stopped: ' + $r.message);" ^
  "    $stopped = $true;" ^
  "    break;" ^
  "  } catch {" ^
  "    if ($_.Exception.Response -and $_.Exception.Response.StatusCode.value__ -eq 403) {" ^
  "      Write-Host ('[SKIP] Port ' + $p + ' rejected the request (not loopback or bad content-type) - unexpected, leaving it alone.');" ^
  "    }" ^
  "  }" ^
  "}" ^
  "if (-not $stopped) { Write-Host '[INFO] No WVN server found listening on 8080, 8081, or 8082.' }"

echo.
pause
exit /b 0
