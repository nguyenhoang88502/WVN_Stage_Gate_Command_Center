@echo off
setlocal
title WVN NPI ^& ECN Stage Gate

set "ROOT=%~dp0"
set "SYS=%ROOT%system"

if not exist "%SYS%\launcher.ps1" (
  echo Could not find system\launcher.ps1 next to this file.
  echo Do not move this shortcut out of the tool folder.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-ChildItem -Path '%ROOT%' -Recurse -ErrorAction SilentlyContinue | Unblock-File -ErrorAction SilentlyContinue" >nul 2>&1

start "" /min powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%SYS%\launcher.ps1"

exit /b 0
