param([string]$Root)
$ErrorActionPreference = 'Stop'
try {
    if (-not $Root) { $Root = Split-Path -Parent $PSScriptRoot }
    $logs = Join-Path $Root 'logs'
    New-Item -ItemType Directory -Path $logs -Force | Out-Null
    [IO.File]::WriteAllText((Join-Path $logs 'setup-bootstrap.log'), 'Installer started', (New-Object Text.UTF8Encoding($false)))
    Add-Type -AssemblyName PresentationFramework
    . (Join-Path $PSScriptRoot 'office-setup-profile.ps1')
    if (-not $Root) { $Root = Split-Path -Parent $PSScriptRoot }
    $Root = [IO.Path]::GetFullPath($Root)
    $profile = Join-Path $Root '.env.office'
    $desktop = [Environment]::GetFolderPath('Desktop')
    $legacy = $null
    $sourceRecord = Join-Path $Root 'logs\install-source.json'
    if (Test-Path -LiteralPath $sourceRecord) { try { $legacy = (Get-Content -LiteralPath $sourceRecord -Raw -Encoding UTF8 | ConvertFrom-Json).legacy } catch { } }
    if (-not (Test-Path -LiteralPath $profile)) {
        $physicalDesktop = Join-Path ([Environment]::GetFolderPath('UserProfile')) 'Desktop'
        $candidates = @(Get-ErpProfileCandidates -Roots @($desktop, $physicalDesktop))
        if ($candidates.Count -eq 1) { $legacy = $candidates[0] } else {
            if (-not (Show-ErpOfficeSetup -Root $Root)) { exit 2 }
        }
        if ($legacy) {
        [IO.File]::Copy((Join-Path $legacy '.env.office'), $profile, $false)
        New-Item -ItemType Directory -Path (Join-Path $Root 'logs') -Force | Out-Null
        [IO.File]::WriteAllText($sourceRecord, (@{legacy=$legacy} | ConvertTo-Json -Compress), (New-Object Text.UTF8Encoding($false)))
        $login = Join-Path $legacy 'ERP-login.txt'
        if ((Test-Path -LiteralPath $login) -and -not (Test-Path -LiteralPath (Join-Path $Root 'ERP-login.txt'))) { [IO.File]::Copy($login, (Join-Path $Root 'ERP-login.txt'), $false) }
        }
    }
    $node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
    if (-not $node) { $node = Join-Path $env:ProgramFiles 'nodejs\node.exe' }
    if (-not (Test-Path -LiteralPath $node)) { throw 'Node.js 24 설치가 필요합니다. 기존 ERP와 DB는 변경하지 않았습니다.' }
    $version = & $node --version
    if ($LASTEXITCODE -ne 0 -or $version -notmatch '^v24\.') { throw 'Node.js 24 설치를 확인하세요. 기존 ERP는 종료하지 않았습니다.' }
    if ($legacy) { $env:ERP_INSTALL_LEGACY_ROOT = $legacy }
    $lines = [IO.File]::ReadAllLines($profile)
    $portLine = @($lines | Where-Object { $_ -match '^PORT=' })
    $port = if ($portLine.Count -eq 1) { ($portLine[0] -replace '^PORT=', '').Trim() } else { '3000' }
    if ($port -notmatch '^\d{1,5}$' -or [int]$port -lt 1 -or [int]$port -gt 65535) { throw 'ERP 포트 설정을 확인하세요.' }
    $listeners = @(Get-NetTCPConnection -State Listen -LocalPort ([int]$port) -ErrorAction SilentlyContinue)
    $owners = @($listeners | ForEach-Object { $_.OwningProcess } | Select-Object -Unique)
    if ($owners.Count) {
        if ($owners.Count -ne 1) { throw '해당 포트에서 여러 프로그램을 확인했습니다. 기존 ERP를 종료한 뒤 다시 설치하세요.' }
        $proc = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + [int]$owners[0])
        if (-not $proc.ExecutablePath -or [IO.Path]::GetFileName($proc.ExecutablePath) -ne 'node.exe' -or $proc.CommandLine -notmatch '(?:dist[\\/]bin[\\/]next|next\.js)' -or $proc.CommandLine -notmatch '\bstart\b') { throw '다른 프로그램이 ERP 포트를 사용 중입니다. 그 프로그램은 종료하지 않았습니다.' }
        $recognized = $false
        # A failed ERP health endpoint must not prevent upgrading our own server.
        $ownedRecord = Join-Path $Root 'logs\office-server.json'
        if (Test-Path -LiteralPath $ownedRecord) {
            try {
                $owned = Get-Content -LiteralPath $ownedRecord -Raw -Encoding UTF8 | ConvertFrom-Json
                $expectedScript = Join-Path $Root 'node_modules\next\dist\bin\next'
                if ([int]$owned.pid -eq [int]$owners[0] -and [IO.Path]::GetFullPath($owned.root) -eq $Root -and $proc.CommandLine.Contains($expectedScript) -and [IO.Path]::GetFullPath($owned.executable) -eq [IO.Path]::GetFullPath($proc.ExecutablePath) -and [string]$owned.port -eq $port) { $recognized = $true }
            } catch { }
        }
        foreach ($listener in $listeners) {
            $hostAddress = [string]$listener.LocalAddress
            if ($hostAddress -notmatch '^(127\.0\.0\.1|10\.[\d.]+|192\.168\.[\d.]+|172\.(1[6-9]|2\d|3[01])\.[\d.]+)$') { continue }
            try { $page = Invoke-WebRequest -UseBasicParsing -Uri ('http://' + $hostAddress + ':' + $port + '/login') -TimeoutSec 3 -MaximumRedirection 0; if ($page.Content -match '동양계전 ERP 로그인') { $recognized = $true; break } } catch { }
        }
        if (-not $recognized) { throw '실행 중인 프로그램이 동양 ERP인지 확인하지 못했습니다. 기존 ERP 창을 닫고 다시 설치하세요.' }
        $answer = [System.Windows.MessageBox]::Show('업데이트를 위해 현재 실행 중인 ERP 서버를 종료할까요? 다른 PC의 접속도 잠시 끊깁니다. 진행 중인 업무를 먼저 저장하세요.', '동양계전 ERP 설치', 'YesNo', 'Warning', 'No')
        if ($answer -ne 'Yes') { exit 2 }
        Stop-Process -Id ([int]$owners[0]) -ErrorAction Stop
        Start-Sleep -Milliseconds 500
    }
    $logs = Join-Path $Root 'logs'
    New-Item -ItemType Directory -Path $logs -Force | Out-Null
    $info = New-Object Diagnostics.ProcessStartInfo
    $info.FileName = $node
    $info.Arguments = '"' + (Join-Path $Root 'scripts\install-office-runtime.mjs') + '"'
    $info.WorkingDirectory = $Root
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $info.StandardOutputEncoding = [Text.Encoding]::UTF8
    $info.StandardErrorEncoding = [Text.Encoding]::UTF8
    $p = New-Object Diagnostics.Process
    $p.StartInfo = $info
    [void]$p.Start()
    $stdout = $p.StandardOutput.ReadToEndAsync()
    $stderr = $p.StandardError.ReadToEndAsync()
    $p.WaitForExit()
    $output = $stdout.Result + [Environment]::NewLine + $stderr.Result
    [IO.File]::WriteAllText((Join-Path $logs 'setup-result.log'), $output, (New-Object Text.UTF8Encoding($false)))
    if ($p.ExitCode -ne 0) { throw ('설치를 완료하지 못했습니다. 기존 자료는 보존됩니다.' + [Environment]::NewLine + $stderr.Result + [Environment]::NewLine + '로그: ' + (Join-Path $logs 'setup.log')) }
    exit 0
} catch {
    # Do not include configuration or exception values in bootstrap diagnostics.
    $diagnostic = 'ERP_INSTALL_FAILED at line ' + $_.InvocationInfo.ScriptLineNumber + '; category: ' + $_.CategoryInfo.Category
    Write-Output $diagnostic
    if (Test-Path -LiteralPath (Join-Path $logs 'setup-result.log')) {
        Write-Output 'Operation details:'
        Get-Content -LiteralPath (Join-Path $logs 'setup-result.log') -Encoding UTF8 -Tail 20 | Write-Output
    }
    try { [IO.File]::AppendAllText((Join-Path $logs 'setup-bootstrap.log'), [Environment]::NewLine + $diagnostic) } catch { }
    try { [System.Windows.MessageBox]::Show('설치가 중단되었습니다. 자동으로 열리는 설치 기록을 확인해 주세요. 회사 자료와 DB는 삭제하지 않았습니다.', '동양계전 ERP 설치') | Out-Null } catch { }
    exit 1
}
