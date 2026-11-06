@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 goto missing
if not exist .env.office goto config
call npm ci
if errorlevel 1 goto failed
call npm run office:prepare
if errorlevel 1 goto failed
call npm run build:office
if errorlevel 1 goto failed
echo ERP is ready. Run ERP-App-install.cmd to create the desktop app shortcut.
pause
exit /b 0
:missing
echo Node.js 24 is required. Install the Windows MSI and reopen this window.
pause
exit /b 1
:config
echo Prepare .env.office first. See docs/OFFICE-PC-AND-NAS.md.
pause
exit /b 1
:failed
echo ERP installation did not finish. Keep this error visible. Do not reset the database.
pause
exit /b 1
