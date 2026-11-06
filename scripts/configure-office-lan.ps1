param([string]$Address = '')
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationFramework
try {
    $root = Split-Path -Parent $PSScriptRoot
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        $arguments = '-NoProfile -ExecutionPolicy Bypass -File "' + $PSCommandPath + '"'
        if ($Address) {
            if ($Address -notmatch '^\d{1,3}(\.\d{1,3}){3}$') { throw 'IPv4 주소 형식을 확인하세요.' }
            $arguments += ' -Address ' + $Address
        }
        Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe') -Verb RunAs -ArgumentList $arguments
        exit 0
    }
    $file = Join-Path $root '.env.office'
    if (-not (Test-Path -LiteralPath $file)) { throw '회사 설정 파일 .env.office를 먼저 준비하세요.' }
    $lines = [IO.File]::ReadAllLines($file)
    $portLines = @($lines | Where-Object { $_ -match '^PORT=' })
    $port = if ($portLines.Count -eq 1) { ($portLines[0] -replace '^PORT=', '').Trim() } else { '3000' }
    if ($port -notmatch '^\d{1,5}$' -or [int]$port -lt 1 -or [int]$port -gt 65535) { throw 'ERP 포트 설정을 확인하세요.' }
    if (Get-NetTCPConnection -State Listen -LocalPort ([int]$port) -ErrorAction SilentlyContinue) { throw '먼저 실행 중인 ERP 서버를 종료한 뒤 사내 접속 설정을 실행하세요.' }
    $addresses = @(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -match '^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)' -and $_.AddressState -eq 'Preferred' })
    if (-not $Address) {
        Add-Type -AssemblyName Microsoft.VisualBasic
        $defaultAddress = if ($addresses.Count) { $addresses[0].IPAddress } else { '' }
        $Address = [Microsoft.VisualBasic.Interaction]::InputBox(('메인 PC의 사내 IPv4 주소를 입력하세요. 이 PC의 주소: ' + (($addresses | ForEach-Object { $_.IPAddress }) -join ', ')), 'Dongyang ERP', $defaultAddress)
        if (-not $Address) { exit 0 }
    }
    $selected = @($addresses | Where-Object { $_.IPAddress -eq $Address })
    if ($selected.Count -ne 1) { throw '실제로 이 메인 PC에 연결된 사내 IPv4 주소를 입력하세요. 공인 주소나 다른 PC 주소는 사용할 수 없습니다.' }
    if (@($lines | Where-Object { $_ -match '^ERP_OFFICE_BIND=' }).Count -ne 1) { throw '회사 설정 파일의 ERP_OFFICE_BIND 항목을 확인하세요.' }
    $node = (Get-Command node.exe -ErrorAction Stop).Source
    $ruleName = 'DongyangERP-LAN-' + $port + '-' + $Address.Replace('.', '-')
    $existing = Get-NetFirewallRule -Name $ruleName -ErrorAction SilentlyContinue
    if ($existing) {
        $addressFilter = $existing | Get-NetFirewallAddressFilter
        $portFilter = $existing | Get-NetFirewallPortFilter
        $appFilter = $existing | Get-NetFirewallApplicationFilter
        if ($existing.Direction -ne 'Inbound' -or $existing.Action -ne 'Allow' -or [int]$existing.Profile -ne 3 -or $existing.Enabled -ne 'True' -or [string]$portFilter.LocalPort -ne $port -or [string]$addressFilter.LocalAddress -ne $Address -or [string]$addressFilter.RemoteAddress -ne 'LocalSubnet' -or $appFilter.Program -ne $node) { throw '같은 이름의 다른 방화벽 규칙이 있습니다. 기존 규칙은 변경하지 않았습니다.' }
    } else {
        New-NetFirewallRule -Name $ruleName -DisplayName ('Dongyang ERP LAN ' + $port) -Direction Inbound -Action Allow -Protocol TCP -LocalPort ([int]$port) -LocalAddress $Address -RemoteAddress LocalSubnet -Profile Private,Domain -Program $node -EdgeTraversalPolicy Block | Out-Null
    }
    $updated = $lines | ForEach-Object { if ($_ -match '^ERP_OFFICE_BIND=') { 'ERP_OFFICE_BIND=' + $Address } else { $_ } }
    [IO.File]::WriteAllLines($file, [string[]]$updated, (New-Object Text.UTF8Encoding($false)))
    $profile = Get-NetConnectionProfile -InterfaceIndex $selected[0].InterfaceIndex -ErrorAction SilentlyContinue
    $message = '사내 접속 설정을 저장했습니다. ERP를 다시 켜세요. 경리 PC 접속 주소: http://' + $Address + ':' + $port
    if ($profile.NetworkCategory -eq 'Public') { $message += [Environment]::NewLine + '현재 네트워크가 공용으로 표시되어 있습니다. 사내 접속 규칙은 개인/도메인 네트워크만 허용합니다. 신뢰할 수 있는 사내망인지 확인한 뒤 네트워크 프로필을 점검하세요. 이 도구는 프로필을 자동 변경하지 않았습니다.' }
    [System.Windows.MessageBox]::Show($message, 'Dongyang ERP') | Out-Null
} catch { [System.Windows.MessageBox]::Show($_.Exception.Message, 'Dongyang ERP') | Out-Null; exit 1 }
