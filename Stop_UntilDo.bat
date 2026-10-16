@echo off
title Stop UntilDo Server
color 0c
cd /d "%~dp0"

echo ============================================================
echo           STOPPING UNTILDO SERVER
echo ============================================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop_server.ps1"

echo.
echo Done! UntilDo server stopped.
timeout /t 2 >nul
exit /b 0
