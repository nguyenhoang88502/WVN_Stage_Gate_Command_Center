@echo off
rem v12.1: stops this PC's server with no console window left behind - the
rem work runs in system\Stop-CommandCenter.ps1 inside a headless console host
rem and the result comes up as a message box. Still the graceful
rem POST /api/shutdown path over loopback, never a process kill.
setlocal
set "SYS=%~dp0system"
set "PS=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
set "HOST=%SystemRoot%\System32\conhost.exe"
if not exist "%HOST%" goto nohost
start "" "%HOST%" --headless "%PS%" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%SYS%\Stop-CommandCenter.ps1"
exit /b 0
:nohost
start "" /min "%PS%" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%SYS%\Stop-CommandCenter.ps1"
exit /b 0
