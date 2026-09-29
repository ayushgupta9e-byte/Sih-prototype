@echo off
title NHAA 14566 - Sahayak AI SIH Prototype v2
cd /d "%~dp0"

echo.
echo ==============================================
echo   NHAA 14566 - Sahayak AI SIH Prototype v2
echo ==============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js is not installed.
  echo Install Node.js LTS, then run this file again.
  pause
  exit /b 1
)

where python >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Python is not installed or not on PATH.
  echo Install Python 3.10+ and select "Add Python to PATH".
  pause
  exit /b 1
)

echo Starting Node backend + Python NLP service...
start "NHAA NLP + Backend" cmd /k "cd /d ""%~dp0"" && node server.js"

timeout /t 3 /nobreak >nul
start "" "http://localhost:5000"

echo.
echo Browser should now open:
echo http://localhost:5000
echo.
echo Keep the backend terminal open while using the prototype.
echo Close the backend terminal to stop the prototype.
pause
