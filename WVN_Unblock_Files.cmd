@echo off
echo Removing the "downloaded from the internet" block from this folder...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-ChildItem -Path '%~dp0' -Recurse | Unblock-File -ErrorAction SilentlyContinue"
echo.
echo Done. You can now run Open_WVN_NPI_Command_Center.cmd
pause
