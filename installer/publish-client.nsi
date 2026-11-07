Unicode true
!include "MUI2.nsh"
!include "LogicLib.nsh"
!ifndef CLIENT_EXE
 !error "CLIENT_EXE is required"
!endif
!ifndef OUTPUT
 !define OUTPUT "ERP-Share-Client.exe"
!endif
Name "동양계전 ERP 공유폴더 연결도구 배치"
OutFile "${OUTPUT}"
RequestExecutionLevel user
SetCompressor /SOLID lzma
!define MUI_WELCOMEPAGE_TEXT "NAS 공유폴더에 경리 PC용 ERP 연결 프로그램을 넣습니다.$\r$\n$\r$\n저장 위치: \\192.168.0.250\work\동양계전ERP$\r$\n파일명: 동양계전ERP_경리PC연결.exe$\r$\n$\r$\nNAS 폴더에 쓰기 권한이 있는 메인 PC에서 실행하세요. 각 PC는 생성된 프로그램을 한 번 실행해 바탕화면 아이콘을 만들면 됩니다. NAS 비밀번호는 저장하거나 변경하지 않습니다."
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_LANGUAGE "Korean"
Section "NAS에 연결 프로그램 배치"
 StrCpy $0 "\\192.168.0.250\work\동양계전ERP"
 IfFileExists "$0\*" 0 no_share
 CreateDirectory "$0\ERP-연결도구백업"
 IfFileExists "$0\동양계전ERP_경리PC연결.exe" 0 write_tool
 System::Call 'kernel32::GetTickCount() i.r1'
 ClearErrors
 CopyFiles /SILENT "$0\동양계전ERP_경리PC연결.exe" "$0\ERP-연결도구백업\ERP-Client-$1.exe"
 IfErrors write_error
 write_tool:
 SetOutPath "$0"
 ClearErrors
 File /oname=동양계전ERP_경리PC연결.exe "${CLIENT_EXE}"
 IfErrors write_error
 FileOpen $2 "$0\ERP-접속안내.txt" w
 FileWriteUTF16LE /BOM $2 "경리 PC 연결 방법$\r$\n$\r$\n1. 동양계전ERP_경리PC연결.exe를 PC별로 처음 한 번 실행하세요.$\r$\n2. 다음부터 바탕화면 동양계전 ERP(경리) 아이콘을 누르세요.$\r$\n3. 메인 PC의 ERP가 켜져 있어야 합니다.$\r$\n4. 접속 주소는 http://192.168.0.12:3000 입니다.$\r$\n5. NAS 로그인은 Windows에서 직접 진행하세요. 이 프로그램은 NAS 비밀번호를 보관하지 않습니다.$\r$\n"
 FileClose $2
 DetailPrint "NAS에 연결 프로그램과 접속 안내를 저장했습니다."
 Goto done
 no_share:
 MessageBox MB_OK|MB_ICONEXCLAMATION "NAS 폴더를 찾지 못했습니다. 탐색기에서 \\192.168.0.250\work\동양계전ERP 에 먼저 접속한 뒤 다시 실행하세요."
 SetErrorLevel 1
 Abort
 write_error:
 MessageBox MB_OK|MB_ICONEXCLAMATION "연결 프로그램을 저장하지 못했습니다. NAS 쓰기 권한과 파일 사용 여부를 확인하세요. 회사 자료와 DB는 변경하지 않았습니다."
 SetErrorLevel 1
 Abort
 done:
SectionEnd
