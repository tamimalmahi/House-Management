@echo off
cd /d "%~dp0"
echo Starting brotel.ms on http://127.0.0.1:4173
echo.
echo Login:
echo   Username: admin
echo   Password: admin123
echo.
node server.js
pause
