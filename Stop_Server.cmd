@echo off
setlocal
title WVN NPI ^& ECN Stage Gate - Stop Server

rem v4.0: the in-app Stop Server button is gone (removed from index.html /
rem app.js on purpose - see the v4.0 spec, section 3). This script is now
rem the only way to stop the server. It uses the same graceful
rem POST /api/shutdown path the button used to - never a process kill -
rem tried in turn against every port the launcher itself tries on startup.

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ports = 8080,8081,8082;" ^
  "$stopped = $false;" ^
  "foreach ($p in $ports) {" ^
  "  try {" ^
  "    $r = Invoke-RestMethod -Uri ('http://127.0.0.1:' + $p + '/api/shutdown') -Method Post -ContentType 'application/json' -Body (@{ user = 'Stop_Server.cmd' } | ConvertTo-Json) -TimeoutSec 3;" ^
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
