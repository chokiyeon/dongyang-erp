@echo off
chcp 65001 >nul
cd /d "%~dp0"
call npm run start:office
if errorlevel 1 (
 echo ERP 실행 상태와 .env.office 설정을 확인하세요.
 pause
)
