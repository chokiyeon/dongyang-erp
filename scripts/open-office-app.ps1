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
    $p = Start-Process -FilePath $node -ArgumentList ('"' + $entry + '"') -WorkingDirectory $root -WindowStyle Hidden -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
    $p.WaitForExit()
    if ($p.ExitCode -ne 0) {
        Add-Type -AssemblyName PresentationFramework
        $detail = if (Test-Path -LiteralPath $stderr) { (Get-Content -LiteralPath $stderr -Raw -Encoding UTF8) } else { '' }
        [System.Windows.MessageBox]::Show(('ERP를 열지 못했습니다.' + [Environment]::NewLine + $detail + [Environment]::NewLine + '로그 위치: ' + $stderr), 'Dongyang ERP') | Out-Null
    }
} catch {
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show($_.Exception.Message, 'Dongyang ERP') | Out-Null
}
