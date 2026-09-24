# Run with Windows PowerShell 5.1, the same runtime used by installed GatedSpace.
[CmdletBinding()]
param([switch]$VerifyLiveDocker)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$sourcePath = Join-Path $PSScriptRoot 'start-gatedspace-local-stack.ps1'
$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($sourcePath, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw 'Launcher syntax failed.' }
foreach ($name in @('Test-DockerEngine', 'Wait-ForAutoStartDataServices')) {
    $target = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true)
    if (-not $target) { throw "Missing function: $name" }
    . ([scriptblock]::Create($target.Extent.Text))
}
$fixtureDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ('gatedspace-startup-test-' + [guid]::NewGuid())
$null = New-Item -ItemType Directory -Path $fixtureDirectory
$fixtureExe = Join-Path $fixtureDirectory 'probe.exe'
$dockerProbeOutLog = Join-Path $fixtureDirectory 'stdout.log'
$dockerProbeErrLog = Join-Path $fixtureDirectory 'stderr.log'
$fixtureSource = @'
using System;
using System.Threading;
public static class DockerProbeFixture {
    public static int Main() {
        string mode = Environment.GetEnvironmentVariable("GATEDSPACE_TEST_PROBE_MODE");
        if (mode == "hang") Thread.Sleep(30000);
        if (mode == "fail") { Console.Error.WriteLine("Unavailable fixture"); return 7; }
        if (mode == "bulk") { Console.Write(new string('x', 131072)); Console.Error.Write(new string('y', 131072)); }
        else Console.WriteLine("29.6.1-fixture");
        return 0;
    }
}
'@
try {
    Add-Type -TypeDefinition $fixtureSource -Language CSharp -OutputAssembly $fixtureExe -OutputType ConsoleApplication
    $dockerCli = $fixtureExe
    $env:GATEDSPACE_TEST_PROBE_MODE = 'ok'
    if (-not (Test-DockerEngine)) { throw 'Successful subprocess was reported unavailable.' }
    'PASS Windows PowerShell retains successful exit code'
    $env:GATEDSPACE_TEST_PROBE_MODE = 'fail'
    if (Test-DockerEngine) { throw 'Failed subprocess was reported healthy.' }
    'PASS nonzero subprocess exit stays unavailable'
    $env:GATEDSPACE_TEST_PROBE_MODE = 'bulk'
    if (-not (Test-DockerEngine)) { throw 'Redirected output deadlocked the subprocess.' }
    'PASS large stdout and stderr are drained without a deadlock'
    $env:GATEDSPACE_TEST_PROBE_MODE = 'hang'
    $clock = [System.Diagnostics.Stopwatch]::StartNew()
    if (Test-DockerEngine -TimeoutMilliseconds 300) { throw 'Hung subprocess was reported healthy.' }
    if ($clock.Elapsed.TotalSeconds -gt 6) { throw 'Probe timeout was not bounded.' }
    'PASS hung probe is terminated within its deadline'
    $dockerCli = Join-Path $fixtureDirectory 'missing.exe'
    if (Test-DockerEngine) { throw 'Missing executable was reported healthy.' }
    'PASS missing executable returns unavailable'
    if ($VerifyLiveDocker) {
        $dockerCli = 'C:\Program Files\Docker\Docker\resources\bin\docker.exe'
        if (-not (Test-DockerEngine)) { throw 'The real Docker engine is unavailable.' }
        'PASS installed Docker engine is detected in Windows PowerShell 5.1'
    }
    $script:ready = $false
    $script:repairs = 0
    $script:engine = 0
    $dataServicePorts = @(3009, 3014, 3015, 3016, 3017)
    function Write-LauncherLog { param($Message) }
    function Start-DockerEngine { $script:engine++ }
    function Test-LocalPort { param($Port) return $script:ready }
    function Start-DataServices { $script:repairs++; $script:ready = $true }
    function Wait-ForCondition { param($Condition, $Description) if (-not (& $Condition)) { throw 'Unhealthy services' } }
    Wait-ForAutoStartDataServices
    if ($script:repairs -ne 1 -or $script:engine -ne 1) { throw 'Missing services were not repaired.' }
    Wait-ForAutoStartDataServices
    if ($script:repairs -ne 1) { throw 'Healthy containers were unnecessarily restarted.' }
    'PASS missing services are restored; healthy containers stay running (mocked)'
} finally {
    Remove-Item Env:GATEDSPACE_TEST_PROBE_MODE -ErrorAction SilentlyContinue
    foreach ($file in @($fixtureExe, $dockerProbeOutLog, $dockerProbeErrLog)) {
        if (Test-Path -LiteralPath $file) { Remove-Item -LiteralPath $file -Force }
    }
    Remove-Item -LiteralPath $fixtureDirectory
}
