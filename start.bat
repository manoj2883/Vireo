@echo off
title Vireo — AI Speech Coach Launcher
echo ===================================================
echo   Vireo — AI Speech Coach (1-Click Launcher)
echo ===================================================
echo.

cd /d "%~dp0"

echo [1/3] Checking Node.js installation...
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo ERROR: Node.js is not installed or not in PATH.
    echo Please install Node.js from https://nodejs.org/ and try again.
    pause
    exit /b 1
)

echo [2/3] Checking dependencies...
if not exist node_modules (
    echo Installing root dependencies...
    call npm install
)

if not exist server\node_modules (
    echo Installing server dependencies...
    cd server
    call npm install
    cd ..
)

echo.
echo [3/3] Launching Backend Server and Frontend App...
echo - Web UI: http://localhost:5173
echo - Backend: http://localhost:3001
echo.
echo Press Ctrl+C in this window to stop the servers anytime.
echo.

call npm run start
pause
