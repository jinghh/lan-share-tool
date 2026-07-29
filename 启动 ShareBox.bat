@echo off
title LAN ShareBox
cd /d "%~dp0"
node server.js
echo.
echo ============================================
echo  Service stopped. Press any key to close...
echo ============================================
pause >nul
