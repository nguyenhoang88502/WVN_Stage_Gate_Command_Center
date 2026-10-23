@echo off
rem v12.1: same as ..\Stop_Server.cmd - stops this PC's server with no
rem console window left behind; the result comes up as a message box.
setlocal
set "SYS=%~dp0"
set "PS=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
set "HOST=%SystemRoot%\System32\conhost.exe"
if not exist "%HOST%" goto nohost
start "" "%HOST%" --headless "%PS%" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%SYS%Stop-CommandCenter.ps1"
exit /b 0
:nohost
start "" /min "%PS%" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%SYS%Stop-CommandCenter.ps1"
exit /b 0
