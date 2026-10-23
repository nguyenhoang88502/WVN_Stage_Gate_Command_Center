@echo off
rem v12.1: this window only exists for a moment. It hands straight over to
rem system\Start-CommandCenter.ps1 running in a HEADLESS console host
rem (conhost.exe --headless), which has no window at all, and closes.
rem On the first run on a PC that script also creates the desktop shortcut
rem "WVN Stage Gate Command Center" for this PC's copy of the folder; after
rem that, start the app from the shortcut and no window appears even briefly.
rem
rem No parenthesised IF blocks below on purpose: a folder name containing ")"
rem (OneDrive paths sometimes do) would end such a block early.
setlocal
set "SYS=%~dp0system"
set "PS=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
set "HOST=%SystemRoot%\System32\conhost.exe"

if not exist "%SYS%\Start-CommandCenter.ps1" goto missing
if not exist "%HOST%" goto nohost

start "" "%HOST%" --headless "%PS%" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%SYS%\Start-CommandCenter.ps1" %*
exit /b 0

:nohost
rem Windows older than 10 (1809): no headless host, fall back to a hidden,
rem minimised PowerShell.
start "" /min "%PS%" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%SYS%\Start-CommandCenter.ps1" %*
exit /b 0

:missing
echo Could not find system\Start-CommandCenter.ps1 next to this file.
echo Keep this file inside the tool folder, next to the "system" folder.
pause
exit /b 1
