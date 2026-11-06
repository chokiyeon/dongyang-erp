@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 goto missing
node scripts\check-office.mjs
set "ERP_CHECK_EXIT=%errorlevel%"
pause
exit /b %ERP_CHECK_EXIT%
:missing
echo Node.js 24 is required. Install the Windows MSI and reopen this window.
pause
exit /b 1
