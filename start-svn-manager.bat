@echo off
title RCM Transfer Hub
cd /d "%~dp0"

if not exist "server\dist\server\src\index.js" (
  echo Building RCM Transfer Hub...
  call npm.cmd run build
  if errorlevel 1 (
    echo Build failed!
    pause
    exit /b 1
  )
)

echo Starting RCM Transfer Hub on http://127.0.0.1:4100 ...
start "" /b cmd /c "timeout /t 2 /nobreak >nul && start http://127.0.0.1:4100"
node server\dist\server\src\index.js
pause
