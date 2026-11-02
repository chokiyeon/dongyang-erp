@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
 echo Node.js 24 설치를 먼저 확인하세요.
 pause
 exit /b 1
)
node scripts\check-office.mjs
set "ERP_CHECK_EXIT=%errorlevel%"
pause
exit /b %ERP_CHECK_EXIT%
