@echo off
title SVN Control Center
cd /d "%~dp0"

if not exist "server\dist\server\src\index.js" (
  echo Building SVN Control Center for first launch...
  call npm.cmd run build
  if errorlevel 1 (
    echo Build failed! Please check Node.js and npm setup.
    pause
    exit /b 1
  )
)

echo Starting SVN Control Center on http://127.0.0.1:4100 ...
start "" /b cmd /c "timeout /t 2 /nobreak >nul && start http://127.0.0.1:4100"
node server\dist\server\src\index.js
pause
