$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationFramework
try {
    $root = Split-Path -Parent $PSScriptRoot
    $file = Join-Path $root 'logs\office-server.json'
    if (-not (Test-Path -LiteralPath $file)) { throw '앱 실행기로 켠 ERP 서버 기록이 없습니다. 명령창에서 켠 ERP는 해당 창에서 종료해 주세요.' }
    $record = Get-Content -LiteralPath $file -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($record.root -ne $root -or [int]$record.pid -le 0 -or [string]$record.port -notmatch '^\d{1,5}$') { throw 'ERP 서버 기록을 확인하지 못했습니다. 실행 중인 프로그램은 종료하지 않았습니다.' }
    $proc = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + [int]$record.pid)
    if (-not $proc) { Remove-Item -LiteralPath $file; [System.Windows.MessageBox]::Show('ERP 서버가 이미 종료되어 있습니다.', 'Dongyang ERP') | Out-Null; exit 0 }
    $entry = Join-Path $root 'node_modules\next\dist\bin\next'
    $portPattern = '--port\s+"?' + [regex]::Escape([string]$record.port) + '"?(?:\s|$)'
    if (-not $proc.ExecutablePath -or $proc.ExecutablePath -ne $record.executable -or -not $proc.CommandLine -or $proc.CommandLine.IndexOf($entry, [StringComparison]::OrdinalIgnoreCase) -lt 0 -or $proc.CommandLine -notmatch $portPattern) { throw '저장된 실행 번호가 다른 프로그램을 가리킵니다. 해당 프로그램을 종료하지 않았습니다.' }
    $answer = [System.Windows.MessageBox]::Show('ERP 서버를 종료할까요? 경리 자리 등 다른 PC의 ERP 접속도 끊깁니다. 먼저 진행 중인 업무를 저장하세요.', 'Dongyang ERP', 'YesNo', 'Warning', 'No')
    if ($answer -ne 'Yes') { exit 0 }
    Stop-Process -Id ([int]$record.pid) -ErrorAction Stop
    Remove-Item -LiteralPath $file
    [System.Windows.MessageBox]::Show('ERP 서버를 종료했습니다. 데이터베이스와 회사 자료는 그대로 보관됩니다.', 'Dongyang ERP') | Out-Null
} catch { [System.Windows.MessageBox]::Show($_.Exception.Message, 'Dongyang ERP') | Out-Null; exit 1 }
