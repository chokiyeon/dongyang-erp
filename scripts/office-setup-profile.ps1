function Get-ErpProfileCandidates([string[]]$Roots) {
    $found = @()
    foreach ($base in @($Roots | Select-Object -Unique)) {
        if (-not $base -or -not (Test-Path -LiteralPath $base)) { continue }
        $folders = @($base)
        foreach ($first in @(Get-ChildItem -LiteralPath $base -Directory -ErrorAction SilentlyContinue)) {
            $folders += $first.FullName
            foreach ($second in @(Get-ChildItem -LiteralPath $first.FullName -Directory -ErrorAction SilentlyContinue)) { $folders += $second.FullName }
        }
        foreach ($folder in $folders) {
            $setting = Join-Path $folder '.env.office'
            $package = Join-Path $folder 'package.json'
            if ((Test-Path -LiteralPath $setting) -and (Test-Path -LiteralPath $package)) {
                try { if ((Get-Content -LiteralPath $package -Raw -Encoding UTF8 | ConvertFrom-Json).name -eq 'dongyang-erp') { $found += $folder } } catch { }
            }
        }
    }
    return @($found | Sort-Object -Unique)
}
function New-ErpOfficeProfile([string]$Root, [string]$DatabasePassword, [string]$AdminPassword) {
    if (-not $DatabasePassword) { throw 'ERP용 DB 암호를 입력하세요.' }
    if ($AdminPassword.Length -lt 8 -or $AdminPassword.Contains([char]39) -or $AdminPassword.Contains([char]10) -or $AdminPassword.Contains([char]13)) { throw 'ERP 로그인 비밀번호는 8자 이상으로 입력하세요. 작은따옴표와 줄바꿈은 제외하세요.' }
    if ($AdminPassword -match '^(REPLACE|local-development-only|password|12345678)') { throw '기본 예시값과 다른 로그인 비밀번호를 정하세요.' }
    $file = Join-Path $Root '.env.office'
    $bytes = New-Object byte[] 32
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    $secret = ([BitConverter]::ToString($bytes)).Replace('-', '').ToLowerInvariant()
    $lines = @('ERP_OFFICE_MODE=true', 'ERP_OFFICE_BIND=127.0.0.1', 'PORT=3000', ('DATABASE_URL=postgresql://erp:' + [Uri]::EscapeDataString($DatabasePassword) + '@127.0.0.1:5432/dongyang_erp'), ('ERP_ADMIN_PASSWORD=' + [char]39 + $AdminPassword + [char]39), ('ERP_SESSION_SECRET=' + $secret), 'ERP_COOKIE_SECURE=false', 'ERP_NAS_BACKUP_DIR=')
    $stream = [IO.FileStream]::new($file, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try { $writer = [IO.StreamWriter]::new($stream, (New-Object Text.UTF8Encoding($false))); $writer.Write(($lines -join [Environment]::NewLine) + [Environment]::NewLine); $writer.Flush() } finally { $stream.Dispose() }
    [IO.File]::WriteAllText((Join-Path $Root 'ERP-login.txt'), ('ERP login password: ' + $AdminPassword + [Environment]::NewLine), (New-Object Text.UTF8Encoding($false)))
}
function Show-ErpOfficeSetup([string]$Root) {
    Add-Type -AssemblyName PresentationFramework
    $window = New-Object Windows.Window
    $window.Title = '동양계전 ERP · 회사 연결 설정'
    $window.Width = 520; $window.Height = 490; $window.ResizeMode = 'NoResize'; $window.WindowStartupLocation = 'CenterScreen'; $window.Topmost = $true
    $panel = New-Object Windows.Controls.StackPanel; $panel.Margin = '24'; $window.Content = $panel
    $intro = New-Object Windows.Controls.TextBlock
    $intro.Text = "기존 설정을 찾지 못했습니다. 아래 값만 한 번 입력하세요.`n회사 자료를 삭제하거나 새 DB를 만들지 않습니다.`n기존 DB: 이 PC / dongyang_erp / 사용자 erp"
    $intro.TextWrapping = 'Wrap'; $intro.Margin = '0,0,0,16'; [void]$panel.Children.Add($intro)
    $boxes = @()
    foreach ($label in @('ERP용 DB 암호 (이전에 erp 계정에 정한 암호)', 'ERP 로그인 비밀번호 (원하는 값, 8자 이상)', 'ERP 로그인 비밀번호 다시 입력')) {
        $text = New-Object Windows.Controls.TextBlock; $text.Text = $label; $text.Margin = '0,8,0,6'; [void]$panel.Children.Add($text)
        $box = New-Object Windows.Controls.PasswordBox; $box.Height = 32; $box.MaxLength = 1024; [void]$panel.Children.Add($box); $boxes += $box
    }
    $errorText = New-Object Windows.Controls.TextBlock; $errorText.Foreground = 'DarkRed'; $errorText.TextWrapping = 'Wrap'; $errorText.Margin = '0,12,0,8'; [void]$panel.Children.Add($errorText)
    $button = New-Object Windows.Controls.Button; $button.Content = '설정 저장 후 설치 계속'; $button.Height = 36; $button.IsDefault = $true; [void]$panel.Children.Add($button)
    $button.Add_Click({
        try {
            if ($boxes[1].Password -ne $boxes[2].Password) { throw '두 로그인 비밀번호가 서로 다릅니다.' }
            New-ErpOfficeProfile -Root $Root -DatabasePassword $boxes[0].Password -AdminPassword $boxes[1].Password
            $window.DialogResult = $true
        } catch { $errorText.Text = $_.Exception.Message }
    })
    [void]$boxes[0].Focus()
    return $window.ShowDialog()
}
