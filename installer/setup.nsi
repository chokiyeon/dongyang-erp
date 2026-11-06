Unicode true
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "x64.nsh"
Var NativePS
!ifndef PAYLOAD
 !error "PAYLOAD is required"
!endif
!ifndef OUTPUT
 !define OUTPUT "ERP.exe"
!endif
Name "동양계전 ERP"
OutFile "${OUTPUT}"
InstallDir "$LOCALAPPDATA\DongyangERP"
InstallDirRegKey HKCU "Software\DongyangERP" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma
ShowInstDetails show
VIProductVersion "0.2.1.0"
VIAddVersionKey /LANG=1042 "ProductName" "동양계전 ERP"
VIAddVersionKey /LANG=1042 "FileDescription" "동양계전 ERP 설치 및 업데이트"
VIAddVersionKey /LANG=1042 "FileVersion" "0.2.1"
VIAddVersionKey /LANG=1042 "ProductVersion" "0.2.1"
VIAddVersionKey /LANG=1042 "LegalCopyright" "Dongyang ERP"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TEXT "메인 PC의 ERP를 설치하거나 업데이트합니다.$\r$\n$\r$\n기존 비밀번호와 DB 설정은 자동으로 찾아 보존합니다. 폴더를 직접 복사할 필요가 없습니다.$\r$\n$\r$\n현재 메인 PC에 설치된 Node.js 24와 PostgreSQL 17, 인터넷 연결을 사용합니다. 구성요소 설치와 화면 생성에 몇 분이 걸릴 수 있습니다."
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_FUNCTION LaunchERP
!define MUI_FINISHPAGE_RUN_TEXT "ERP 열기"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Korean"
Function LaunchERP
 Exec '"$NativePS" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "$INSTDIR\scripts\open-office-app.ps1"'
FunctionEnd
Function .onInit
 ${IfNot} ${RunningX64}
  MessageBox MB_OK|MB_ICONEXCLAMATION "64비트 Windows 메인 PC에서 실행하세요."
  Abort
 ${EndIf}
 StrCpy $NativePS "$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe"
 System::Call 'kernel32::CreateMutexW(p 0, i 0, w "Local\DongyangERPSetup") p .r0 ?e'
 Pop $1
 ${If} $1 == 183
  MessageBox MB_OK|MB_ICONEXCLAMATION "다른 ERP 설치가 진행 중입니다. 먼저 실행한 설치가 끝날 때까지 기다리세요."
  Abort
 ${EndIf}
FunctionEnd
Section "ERP 설치" SEC01
 SetShellVarContext current
 SetOutPath "$INSTDIR"
 File /r "${PAYLOAD}/*"
 DetailPrint "기존 설정 확인 · 구성요소 설치 · DB 백업 · 업데이트 · 실행 확인 중입니다. 잠시 기다려 주세요."
 ExecWait '"$NativePS" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "$INSTDIR\scripts\install-office-runtime.ps1" -Root "$INSTDIR"' $0
 ${If} $0 != 0
  SetErrorLevel 1
  MessageBox MB_OK|MB_ICONEXCLAMATION "설치가 완료되지 않았습니다. 기존 DB를 삭제하거나 초기화하지 마세요.$\r$\n설정과 오류 기록은 설치 폴더에 보존됩니다."
  Abort
 ${EndIf}
 WriteRegStr HKCU "Software\DongyangERP" "InstallDir" "$INSTDIR"
 WriteUninstaller "$INSTDIR\Uninstall.exe"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\DongyangERP" "DisplayName" "동양계전 ERP"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\DongyangERP" "DisplayVersion" "0.2.1"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\DongyangERP" "InstallLocation" "$INSTDIR"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\DongyangERP" "UninstallString" '"$INSTDIR\Uninstall.exe"'
 WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\DongyangERP" "NoModify" 1
 WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\DongyangERP" "NoRepair" 1
 CreateDirectory "$SMPROGRAMS\동양계전 ERP"
 CreateShortcut "$SMPROGRAMS\동양계전 ERP\동양계전 ERP.lnk" "$WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "$INSTDIR\scripts\open-office-app.ps1"'
 CreateShortcut "$SMPROGRAMS\동양계전 ERP\사내 접속 설정.lnk" "$WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" '-NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\scripts\configure-office-lan.ps1"'
 DetailPrint "설치 완료. 바탕화면의 동양계전 ERP 아이콘을 사용하세요."
SectionEnd
Section "Uninstall"
 SetShellVarContext current
 MessageBox MB_OK|MB_ICONINFORMATION "바로가기와 앱 등록만 해제합니다. ERP 프로그램 폴더, DB, 비밀번호 설정, 백업은 삭제하지 않습니다."
 Delete "$DESKTOP\동양계전 ERP.lnk"
 Delete "$DESKTOP\ERP 서버 종료.lnk"
 Delete "$SMPROGRAMS\동양계전 ERP\동양계전 ERP.lnk"
 Delete "$SMPROGRAMS\동양계전 ERP\사내 접속 설정.lnk"
 RMDir "$SMPROGRAMS\동양계전 ERP"
 DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\DongyangERP"
 DeleteRegKey HKCU "Software\DongyangERP"
SectionEnd
