@echo off
title UntilDo - Smart Daily Tasks & AI Knowledge Suite
color 0b

:: Navigate to project directory
cd /d "%~dp0"

echo ============================================================
echo         UNTILDO - SMART DAILY TASKS & AI KNOWLEDGE SUITE
echo ============================================================
echo.
echo [*] Checking Python installation...
where python >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Python was not found in your system PATH!
    echo Please install Python 3.10+ from python.org or the Microsoft Store.
    pause
    exit /b 1
)

echo [*] Starting UntilDo application...
echo [*] Standalone App window will launch automatically once ready.
echo [*] To close the server, close this window or run Stop_UntilDo.bat.
echo.

python run.py

pause
