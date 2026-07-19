[CmdletBinding()]
param(
	[string]$RepoRoot = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
	$RepoRoot = Split-Path -Parent $PSScriptRoot
}

$launcherScript = Join-Path $RepoRoot "scripts\start-gatedspace-local-stack.ps1"
if (-not (Test-Path -LiteralPath $launcherScript)) {
	throw "GatedSpace launcher was not found at $launcherScript."
}

$runKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
$runName = "GatedSpaceLocalStack"
$runCommand = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}" -UseDockerAutoStart -LaunchApp -RestartAppAfterRecovery' -f $launcherScript

New-Item -Path $runKey -Force | Out-Null
New-ItemProperty -Path $runKey -Name $runName -Value $runCommand -PropertyType String -Force | Out-Null

# Remove only the obsolete task created by earlier versions of this launcher.
if (Get-ScheduledTask -TaskName "GatedSpace Local Stack" -ErrorAction SilentlyContinue) {
	Unregister-ScheduledTask -TaskName "GatedSpace Local Stack" -Confirm:$false
}

[pscustomobject]@{
	StartupMechanism = "Current-user Run key"
	Name = $runName
	Command = (Get-ItemPropertyValue -Path $runKey -Name $runName)
}
