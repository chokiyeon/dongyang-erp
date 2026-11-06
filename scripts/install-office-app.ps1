param([switch]$Quiet, [string]$ReplaceFromRoot = '')
$ErrorActionPreference = 'Stop'
try {
    $root = Split-Path -Parent $PSScriptRoot
    if (-not (Test-Path -LiteralPath (Join-Path $root '.env.office'))) { throw '회사 설정 파일 .env.office를 먼저 준비하세요.' }
    $desktop = [Environment]::GetFolderPath('Desktop')
    $shell = New-Object -ComObject WScript.Shell
    $items = @(@('동양계전 ERP.lnk', 'open-office-app.ps1'), @('ERP 서버 종료.lnk', 'stop-office-app.ps1'))
    foreach ($item in $items) {
        $path = Join-Path $desktop $item[0]
        if (Test-Path -LiteralPath $path) {
            $old = $shell.CreateShortcut($path)
            if ($old.WorkingDirectory -ne $root -and (-not $ReplaceFromRoot -or $old.WorkingDirectory -ne $ReplaceFromRoot)) { throw '다른 폴더의 ERP 바로가기가 이미 있습니다. 기존 바로가기는 변경하지 않았습니다.' }
        }
    }
    foreach ($item in $items) {
        $shortcut = $shell.CreateShortcut((Join-Path $desktop $item[0]))
        $target = Join-Path $PSScriptRoot $item[1]
        $shortcut.TargetPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
        $shortcut.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $target + '"'
        $shortcut.WorkingDirectory = $root
        $shortcut.Description = 'Dongyang ERP'
        $shortcut.IconLocation = (Join-Path $env:SystemRoot 'System32\shell32.dll') + ',21'
        $shortcut.WindowStyle = 7
        $shortcut.Save()
    }
    Add-Type -AssemblyName PresentationFramework
    if (-not $Quiet) { [System.Windows.MessageBox]::Show('바탕화면에 동양계전 ERP 아이콘을 만들었습니다. 아이콘을 누르면 서버와 ERP 화면이 함께 열립니다.', 'Dongyang ERP') | Out-Null }
} catch {
    Add-Type -AssemblyName PresentationFramework
    if ($Quiet) { Write-Error $_.Exception.Message -ErrorAction Continue } else { [System.Windows.MessageBox]::Show($_.Exception.Message, 'Dongyang ERP') | Out-Null }
    exit 1
}
