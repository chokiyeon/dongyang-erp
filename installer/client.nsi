Unicode true
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "x64.nsh"
Var NativePS
!ifndef CLIENT_SOURCE
 !error "CLIENT_SOURCE is required"
!endif
!ifndef OUTPUT
 !define OUTPUT "Client.exe"
!endif
Name "동양계전 ERP 경리 PC 연결"
OutFile "${OUTPUT}"
RequestExecutionLevel user
SetCompressor /SOLID lzma
!define MUI_WELCOMEPAGE_TEXT "경리 PC 바탕화면에 ERP 연결 아이콘을 만듭니다.$\r$\n$\r$\n메인 PC에서 ERP가 실행 중이어야 합니다. 메인 PC 주소는 192.168.0.12입니다.$\r$\n$\r$\n이 PC에는 DB나 Node.js를 설치하지 않습니다."
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_LANGUAGE "Korean"
Function .onInit
 StrCpy $NativePS "$SYSDIR\WindowsPowerShell\v1.0\powershell.exe"
 ${If} ${RunningX64}
  StrCpy $NativePS "$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe"
 ${EndIf}
FunctionEnd
Section "연결 아이콘 설치"
 InitPluginsDir
 SetOutPath "$PLUGINSDIR"
 File "${CLIENT_SOURCE}"
 ExecWait '"$NativePS" -NoProfile -ExecutionPolicy Bypass -File "$PLUGINSDIR\install-office-client.ps1" -Address 192.168.0.12' $0
 ${If} $0 != 0
  SetErrorLevel 1
  Abort
 ${EndIf}
SectionEnd
