@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
 echo Node.js 24 설치를 먼저 확인하세요.
 pause
 exit /b 1
)
if not exist .env.office (
 echo .env.office.example을 참고해 회사 PC의 .env.office 설정을 먼저 준비하세요.
 echo 비밀번호나 세션 키를 채팅에 보내지 마세요.
 pause
 exit /b 1
)
call npm ci
if errorlevel 1 goto failed
call npm run office:prepare
if errorlevel 1 goto failed
call npm run build:office
if errorlevel 1 goto failed
echo ERP 설치 준비를 완료했습니다. ERP-start.cmd로 실행하세요.
pause
exit /b 0
:failed
echo 설치를 완료하지 못했습니다. 표시된 오류를 확인하세요. 기존 DB를 초기화하지 마세요.
pause
exit /b 1
