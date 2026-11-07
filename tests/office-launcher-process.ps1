$ErrorActionPreference = 'Stop'
. (Join-Path (Split-Path -Parent $PSScriptRoot) 'scripts/office-launcher-process.ps1')
$folder = Join-Path ([IO.Path]::GetTempPath()) ('erp-launcher-test-' + [Guid]::NewGuid().ToString('N'))
[void](New-Item -ItemType Directory -Path $folder)
$encoding = New-Object Text.UTF8Encoding($false)
try {
    $node = (Get-Command node).Source
    $ok = Join-Path $folder 'ok.mjs'
    $bad = Join-Path $folder 'bad.mjs'
    $large = Join-Path $folder 'large.mjs'
    [IO.File]::WriteAllText($ok, 'console.log("ERP launched");', $encoding)
    [IO.File]::WriteAllText($bad, 'console.error("failure");process.exitCode=7;', $encoding)
    [IO.File]::WriteAllText($large, 'process.stdout.write("A".repeat(150000));process.stderr.write("B".repeat(150000));', $encoding)
    for ($i=0; $i -lt 10; $i++) {
        $result = Invoke-ErpLauncherProcess $node $ok $folder
        if ($result.ExitCode -ne 0 -or $result.Stdout -notmatch 'ERP launched' -or $result.Stderr) { throw 'Success was incorrectly classified' }
    }
    $result = Invoke-ErpLauncherProcess $node $bad $folder
    if ($result.ExitCode -ne 7 -or $result.Stderr -notmatch 'failure') { throw 'Failure was incorrectly classified' }
    $result = Invoke-ErpLauncherProcess $node $large $folder
    if ($result.ExitCode -ne 0 -or $result.Stdout.Length -ne 150000 -or $result.Stderr.Length -ne 150000) { throw 'Redirected streams blocked or lost output' }
    Write-Output 'PASS: short process exit codes, error output and concurrent large stdout/stderr'
} finally { Remove-Item -LiteralPath $folder -Recurse -Force }
