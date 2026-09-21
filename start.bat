@echo off
title TradeLab
node "%~dp0build.cjs"
if errorlevel 1 (
  echo Build failed. Fix errors then restart.
  pause
  exit /b 1
)
start "TradeLab Server" cmd /k "node "%~dp0server.cjs""
timeout /t 2 /nobreak >nul
start "" "http://localhost:8765/index.html#/workspace"