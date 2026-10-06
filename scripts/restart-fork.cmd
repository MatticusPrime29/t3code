@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0t3-fork-production.ps1" restart
if errorlevel 1 (
  echo.
  echo T3 Code could not be restarted. Review the error above.
  pause
  exit /b 1
)
