@echo off
setlocal
title WVN NPI ^& ECN Stage Gate - Package Bundle

set "ROOT=%~dp0"
set "SYS=%ROOT%system"

if not exist "%SYS%\Package-App.ps1" (
  echo Could not find system\Package-App.ps1 next to this file.
  echo Do not move this shortcut out of the tool folder.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%SYS%\Package-App.ps1"

echo.
pause
exit /b 0
