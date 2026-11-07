param([string]$Address = '', [int]$Port = 3000)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationFramework
try {
    if (-not $Address) {
        Add-Type -AssemblyName Microsoft.VisualBasic
        $Address = [Microsoft.VisualBasic.Interaction]::InputBox('메인 PC의 사내 IPv4 주소를 입력하세요. 예: 192.168.0.12', '동양계전 ERP 경리 PC 연결', '')
        if (-not $Address) { exit 0 }
    }
    $parsed = $null
    if ($Address -notmatch '^\d{1,3}(\.\d{1,3}){3}$' -or -not [Net.IPAddress]::TryParse($Address, [ref]$parsed)) { throw '사내 IPv4 주소 형식을 확인하세요.' }
    $Address = $parsed.ToString()
    if ($Address -notmatch '^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)' -or $Port -lt 1 -or $Port -gt 65535) { throw '메인 PC의 사내 주소와 ERP 포트를 확인하세요.' }
    $url = 'http://' + $Address + ':' + $Port + '/login'
    $candidates = @()
    if (${env:ProgramFiles(x86)}) { $candidates += Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe' }
    if ($env:ProgramFiles) { $candidates += Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe'; $candidates += Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe' }
    if ($env:LOCALAPPDATA) { $candidates += Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe' }
    $browser = $candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if (-not $browser) { throw 'Edge 또는 Chrome을 먼저 설치하세요. 지금은 브라우저에 직접 주소를 입력해 접속할 수 있습니다.' }
    $path = Join-Path ([Environment]::GetFolderPath('Desktop')) '동양계전 ERP(경리).lnk'
    $shell = New-Object -ComObject WScript.Shell
    if (Test-Path -LiteralPath $path) {
        $old = $shell.CreateShortcut($path)
        if ($old.Description -ne 'DongyangERP-client') { throw '같은 이름의 다른 바로가기가 있습니다. 기존 바로가기는 변경하지 않았습니다.' }
    }
    $shortcut = $shell.CreateShortcut($path)
    $shortcut.TargetPath = $browser
    $shortcut.Arguments = '--app=' + $url + ' --new-window'
    $shortcut.Description = 'DongyangERP-client'
    $shortcut.IconLocation = $browser + ',0'
    $shortcut.Save()
    $nasPath = Join-Path ([Environment]::GetFolderPath('Desktop')) '동양계전 ERP 공유폴더.lnk'
    if (Test-Path -LiteralPath $nasPath) {
        $oldNas = $shell.CreateShortcut($nasPath)
        if ($oldNas.Description -ne 'DongyangERP-NAS') { throw '공유폴더 바로가기와 같은 이름의 다른 파일이 있습니다. 변경하지 않았습니다.' }
    }
    $nas = $shell.CreateShortcut($nasPath)
    $nas.TargetPath = Join-Path $env:SystemRoot 'explorer.exe'
    $nas.Arguments = '"\\192.168.0.250\work\동양계전ERP"'
    $nas.Description = 'DongyangERP-NAS'
    $nas.Save()
    [System.Windows.MessageBox]::Show(('바탕화면에 경리 PC용 ERP와 NAS 공유폴더 아이콘을 만들었습니다.' + [Environment]::NewLine + '메인 PC에서 ERP가 켜져 있어야 연결됩니다.' + [Environment]::NewLine + $url + [Environment]::NewLine + 'NAS 로그인은 윈도우에서 직접 진행하세요. NAS 비밀번호는 ERP에 저장하지 않습니다.'), '동양계전 ERP') | Out-Null
} catch { [System.Windows.MessageBox]::Show($_.Exception.Message, '동양계전 ERP') | Out-Null; exit 1 }
