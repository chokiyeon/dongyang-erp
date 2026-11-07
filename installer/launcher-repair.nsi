Unicode true
!include "MUI2.nsh"
!include "LogicLib.nsh"
Var NativePS
Var BackupDir
!ifndef SOURCE
 !error "SOURCE is required"
!endif
!ifndef OUTPUT
 !define OUTPUT "ERP-Launcher-Fix.exe"
!endif
Name "동양계전 ERP 메인PC 실행 복구"
OutFile "${OUTPUT}"
InstallDir "$LOCALAPPDATA\DongyangERP"
InstallDirRegKey HKCU "Software\DongyangERP" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma
VIProductVersion "0.2.6.0"
VIAddVersionKey /LANG=1042 "ProductName" "동양계전 ERP 실행기 복구"
VIAddVersionKey /LANG=1042 "FileDescription" "ERP 실행 결과 확인 오류 복구"
VIAddVersionKey /LANG=1042 "FileVersion" "0.2.6"
VIAddVersionKey /LANG=1042 "LegalCopyright" "Dongyang ERP"
!define MUI_WELCOMEPAGE_TEXT "ERP가 설치된 메인 PC에서 실행합니다. 경리 PC에는 실행하지 마세요.$\r$\n설치된 ERP의 실행기만 복구합니다.$\r$\n$\r$\nDB·비밀번호·회사 자료는 변경하지 않으며, 구성요소 설치나 화면 빌드를 다시 하지 않습니다.$\r$\n$\r$\n기존 실행기 파일은 백업 폴더에 보존합니다."
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_FUNCTION LaunchERP
!define MUI_FINISHPAGE_RUN_TEXT "ERP 열기"
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
Section "실행기 복구"
 IfFileExists "$INSTDIR\scripts\office-desktop.mjs" 0 missing_install
 IfFileExists "$INSTDIR\scripts\open-office-app.ps1" 0 missing_install
 System::Call 'kernel32::GetTickCount() i.r0'
 System::Call 'kernel32::GetCurrentProcessId() i.r1'
 StrCpy $BackupDir "$INSTDIR\backups\launcher-fix\$0-$1"
 IfFileExists "$BackupDir\*" backup_failed 0
 ClearErrors
 CreateDirectory "$BackupDir"
 CopyFiles /SILENT "$INSTDIR\scripts\open-office-app.ps1" "$BackupDir"
 IfErrors backup_failed
 IfFileExists "$INSTDIR\scripts\office-launcher-process.ps1" 0 backup_done
 CopyFiles /SILENT "$INSTDIR\scripts\office-launcher-process.ps1" "$BackupDir"
 IfErrors backup_failed
 backup_done:
 CopyFiles /SILENT "$INSTDIR\scripts\office-desktop.mjs" "$BackupDir"
 IfErrors backup_failed
 SetOutPath "$INSTDIR\scripts"
 ClearErrors
 File "${SOURCE}/scripts/open-office-app.ps1"
 File "${SOURCE}/scripts/office-launcher-process.ps1"
 File "${SOURCE}/scripts/office-desktop.mjs"
 IfErrors write_failed
 DetailPrint "실행기를 복구했습니다. 기존 실행기는 $BackupDir 에 보존했습니다."
 Goto done
 missing_install:
 MessageBox MB_OK|MB_ICONEXCLAMATION "설치된 메인 PC의 ERP를 찾지 못했습니다. 이 도구는 메인 PC에서 실행하세요."
 SetErrorLevel 1
 Abort
 backup_failed:
 MessageBox MB_OK|MB_ICONEXCLAMATION "실행기 백업에 실패해 복구를 중단했습니다."
 SetErrorLevel 1
 Abort
 write_failed:
 MessageBox MB_OK|MB_ICONEXCLAMATION "실행기를 복구하지 못했습니다. 기존 실행기는 백업 폴더에 보존했습니다."
 SetErrorLevel 1
 Abort
 done:
SectionEnd
