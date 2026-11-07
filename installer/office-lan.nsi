Unicode true
!include "MUI2.nsh"
!include "LogicLib.nsh"
Var NativePS
!ifndef SOURCE
 !error "SOURCE is required"
!endif
!ifndef OUTPUT
 !define OUTPUT "ERP-Main-LAN.exe"
!endif
Name "동양계전 ERP 경리 PC 접속 설정"
OutFile "${OUTPUT}"
InstallDir "$LOCALAPPDATA\DongyangERP"
InstallDirRegKey HKCU "Software\DongyangERP" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma
!define MUI_WELCOMEPAGE_TEXT "이 도구는 ERP가 설치된 메인 PC에서 실행합니다.$\r$\n$\r$\n경리 PC가 http://192.168.0.12:3000 에 접속할 수 있도록 ERP 주소와 사내 방화벽 규칙을 설정합니다. 실제 메인 PC에 이 주소가 있어야 합니다.$\r$\n$\r$\n기존 업무를 저장하세요. 현재 ERP를 종료할지 묻고, 윈도우 관리자 권한 확인창이 나타납니다. DB나 NAS 비밀번호는 변경하지 않습니다."
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_FUNCTION LaunchERP
!define MUI_FINISHPAGE_RUN_TEXT "설정한 주소로 ERP 열기"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_LANGUAGE "Korean"
Function .onInit
 StrCpy $NativePS "$WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe"
 IfFileExists "$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe" 0 +2
 StrCpy $NativePS "$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe"
FunctionEnd
Function LaunchERP
 Exec '"$NativePS" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "$INSTDIR\scripts\open-office-app.ps1"'
FunctionEnd
Section "경리 PC 접속 설정"
 IfFileExists "$INSTDIR\.env.office" 0 missing
 SetOutPath "$INSTDIR\scripts"
 File "${SOURCE}/scripts/configure-office-lan.ps1"
 ExecWait '"$NativePS" -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\scripts\configure-office-lan.ps1" -Address 192.168.0.12' $0
 ${If} $0 != 0
  MessageBox MB_OK|MB_ICONEXCLAMATION "사내 접속 설정이 완료되지 않았습니다. 표시된 안내를 확인하세요."
  SetErrorLevel 1
  Abort
 ${EndIf}
 Goto done
 missing:
 MessageBox MB_OK|MB_ICONEXCLAMATION "메인 PC의 설치된 ERP를 찾지 못했습니다. 메인 PC에서 실행하세요."
 SetErrorLevel 1
 Abort
 done:
SectionEnd
