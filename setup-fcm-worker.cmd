@echo off
chcp 65001 >nul
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-fcm-worker.ps1"
set "EXIT_CODE=%ERRORLEVEL%"
echo.
if not "%EXIT_CODE%"=="0" (
  echo Setup failed. Review the message above.
) else (
  echo Setup completed successfully.
)
pause
exit /b %EXIT_CODE%
