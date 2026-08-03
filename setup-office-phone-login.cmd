@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-office-phone-login.ps1"
if errorlevel 1 pause
endlocal
