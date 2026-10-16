@echo off
title Create UntilDo Desktop Shortcut
color 0a
cd /d "%~dp0"

echo ============================================================
echo          CREATING UNTILDO DESKTOP SHORTCUT
echo ============================================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0create_shortcut.ps1"

echo.
echo ============================================================
echo You can now launch UntilDo directly from your Desktop!
echo ============================================================
echo.
pause
