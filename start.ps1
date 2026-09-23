# Vireo PowerShell 1-Click Launcher
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

Write-Host "===================================================" -ForegroundColor Cyan
Write-Host "  Vireo — AI Speech Coach (1-Click Launcher)" -ForegroundColor Cyan
Write-Host "===================================================" -ForegroundColor Cyan
Write-Host ""

# 1. Check Node.js
try {
    $nodeVersion = node -v
    Write-Host "[1/3] Node.js detected: $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "ERROR: Node.js is not installed or not in PATH." -ForegroundColor Red
    Write-Host "Please install Node.js from https://nodejs.org/" -ForegroundColor Yellow
    Read-Host "Press Enter to exit..."
    exit 1
}

# 2. Check dependencies
if (-not (Test-Path "node_modules")) {
    Write-Host "[2/3] Installing root dependencies..." -ForegroundColor Yellow
    npm install
}

if (-not (Test-Path "server\node_modules")) {
    Write-Host "[2/3] Installing server dependencies..." -ForegroundColor Yellow
    Set-Location "server"
    npm install
    Set-Location $ScriptDir
}

Write-Host ""
Write-Host "[3/3] Launching Full Stack Application..." -ForegroundColor Green
Write-Host "- Web UI: http://localhost:5173" -ForegroundColor Cyan
Write-Host "- Backend: http://localhost:3001" -ForegroundColor Cyan
Write-Host ""
Write-Host "Press Ctrl+C to stop the servers anytime." -ForegroundColor Gray
Write-Host ""

npm run start
