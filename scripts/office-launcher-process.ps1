function Invoke-ErpLauncherProcess([string]$Executable, [string]$Entry, [string]$WorkingDirectory) {
    # Own the Process handle: Start-Process -PassThru can expose a null ExitCode
    # on Windows PowerShell even after waiting for a short-lived process.
    $info = New-Object Diagnostics.ProcessStartInfo
    $info.FileName = $Executable
    $info.Arguments = '"' + $Entry + '"'
    $info.WorkingDirectory = $WorkingDirectory
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $info.StandardOutputEncoding = [Text.Encoding]::UTF8
    $info.StandardErrorEncoding = [Text.Encoding]::UTF8
    $process = New-Object Diagnostics.Process
    $process.StartInfo = $info
    try {
        [void]$process.Start()
        $stdoutTask = $process.StandardOutput.ReadToEndAsync()
        $stderrTask = $process.StandardError.ReadToEndAsync()
        $process.WaitForExit()
        return [pscustomobject]@{ ExitCode = [int]$process.ExitCode; Stdout = $stdoutTask.Result; Stderr = $stderrTask.Result }
    } finally { $process.Dispose() }
}
