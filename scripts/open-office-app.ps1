$ErrorActionPreference = 'Stop'
try {
    $root = Split-Path -Parent $PSScriptRoot
    $node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
    if (-not $node) { $node = Join-Path $env:ProgramFiles 'nodejs\node.exe' }
    if (-not (Test-Path -LiteralPath $node)) { throw 'Node.js 24 설치 파일(.msi)로 먼저 설치해 주세요.' }
    $logs = Join-Path $root 'logs'
    New-Item -ItemType Directory -Path $logs -Force | Out-Null
    $id = [Guid]::NewGuid().ToString('N')
    $stdout = Join-Path $logs ('app-' + $id + '.log')
    $stderr = Join-Path $logs ('app-' + $id + '.error.log')
    $entry = Join-Path $root 'scripts\office-desktop.mjs'
    . (Join-Path $PSScriptRoot 'office-launcher-process.ps1')
    $result = Invoke-ErpLauncherProcess -Executable $node -Entry $entry -WorkingDirectory $root
    $encoding = New-Object Text.UTF8Encoding($true)
    [IO.File]::WriteAllText($stdout, $result.Stdout, $encoding)
    [IO.File]::WriteAllText($stderr, $result.Stderr, $encoding)
    if ($result.ExitCode -ne 0) {
        Add-Type -AssemblyName PresentationFramework
        $detail = $result.Stderr.Trim()
        if (-not $detail) { $detail = '실행기가 종료 코드 ' + $result.ExitCode + '을 반환했습니다. 출력 로그: ' + $stdout }
        [System.Windows.MessageBox]::Show(('ERP를 열지 못했습니다.' + [Environment]::NewLine + $detail + [Environment]::NewLine + '로그 위치: ' + $stderr), 'Dongyang ERP') | Out-Null
        exit 1
    }
    exit 0
} catch {
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show($_.Exception.Message, 'Dongyang ERP') | Out-Null
}
