[CmdletBinding()]
param(
	[switch]$AppOnly,
	[switch]$UseDockerAutoStart,
	[switch]$LaunchApp,
	[switch]$RestartAppAfterRecovery,
	[string]$RepoRoot = "",
	[int]$TimeoutSeconds = 240
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
	$RepoRoot = Split-Path -Parent $PSScriptRoot
}

$dockerCli = "C:\Program Files\Docker\Docker\resources\bin\docker.exe"
$dockerDesktop = "C:\Program Files\Docker\Docker\Docker Desktop.exe"
# Prefer bun on PATH; fall back to the WinGet install location (any arch).
$bun = (Get-Command bun -ErrorAction SilentlyContinue).Source
if ([string]::IsNullOrWhiteSpace($bun)) {
	$wingetBun = Get-ChildItem -Path "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\Oven-sh.Bun_*\bun-windows-*\bun.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
	if ($null -ne $wingetBun) { $bun = $wingetBun.FullName }
}
if ([string]::IsNullOrWhiteSpace($bun)) {
	throw "bun.exe not found on PATH or in the WinGet packages folder. Install Bun first."
}
$gatedSpaceExe = Join-Path $env:LOCALAPPDATA "Programs\GatedSpace\GatedSpace.exe"
$composeFile = Join-Path $RepoRoot "docker-compose.yml"
$envFile = Join-Path $RepoRoot ".env"
$logDirectory = Join-Path $env:LOCALAPPDATA "GatedSpace\logs"
$launcherLog = Join-Path $logDirectory "local-stack-launcher.log"
$servicesOutLog = Join-Path $logDirectory "local-stack-services.out.log"
$servicesErrLog = Join-Path $logDirectory "local-stack-services.err.log"
$servicesPidFile = Join-Path $logDirectory "local-stack-services.pid"
$dockerProbeOutLog = Join-Path $logDirectory "docker-probe.out.log"
$dockerProbeErrLog = Join-Path $logDirectory "docker-probe.err.log"
$applicationPorts = @(3001, 3010, 3012, 3018)
$dataServicePorts = @(3009, 3014, 3015, 3016, 3017)

$workspaceName = Split-Path -Leaf $RepoRoot
$sanitizedWorkspaceName = ($workspaceName.ToLowerInvariant() -replace "[^a-z0-9_-]", "-").Trim("-")
$composeProject = "superset-$sanitizedWorkspaceName"

New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null

function Write-LauncherLog {
	param([string]$Message)
	$line = "{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
	Add-Content -LiteralPath $launcherLog -Value $line
}

function Test-LocalPort {
	param([int]$Port)
	$client = [System.Net.Sockets.TcpClient]::new()
	try {
		$connection = $client.BeginConnect("127.0.0.1", $Port, $null, $null)
		if (-not $connection.AsyncWaitHandle.WaitOne(750)) {
			return $false
		}
		$client.EndConnect($connection)
		return $client.Connected
	} catch {
		return $false
	} finally {
		$client.Dispose()
	}
}

function Wait-ForCondition {
	param(
		[scriptblock]$Condition,
		[string]$Description,
		[int]$Seconds = $TimeoutSeconds
	)

	$deadline = (Get-Date).AddSeconds($Seconds)
	do {
		if (& $Condition) {
			return
		}
		Start-Sleep -Seconds 2
	} while ((Get-Date) -lt $deadline)

	throw "Timed out waiting for $Description after $Seconds seconds."
}

function Test-DockerEngine {
	$probe = $null
	try {
		$startArguments = @{
			FilePath = $dockerCli
			ArgumentList = @("info", "--format", "{{.ServerVersion}}")
			WindowStyle = "Hidden"
			RedirectStandardOutput = $dockerProbeOutLog
			RedirectStandardError = $dockerProbeErrLog
			PassThru = $true
		}
		$probe = Start-Process @startArguments
		if (-not $probe.WaitForExit(10000)) {
			$probe.Kill()
			$probe.WaitForExit()
			return $false
		}
		return $probe.ExitCode -eq 0
	} catch {
		if ($probe -and -not $probe.HasExited) {
			$probe.Kill()
		}
		return $false
	}
}

function Start-DockerEngine {
	if (Test-DockerEngine) {
		Write-LauncherLog "Docker engine is already ready."
		return
	}

	Write-LauncherLog "Starting Docker Desktop."
	if (-not (Get-Process -Name "Docker Desktop" -ErrorAction SilentlyContinue)) {
		Start-Process -FilePath $dockerDesktop -WindowStyle Hidden | Out-Null
	}

	Wait-ForCondition -Condition { Test-DockerEngine } -Description "Docker Desktop"
	Write-LauncherLog "Docker engine is ready."
}

function Wait-ForAutoStartDataServices {
	if (-not (Get-Process -Name "Docker Desktop" -ErrorAction SilentlyContinue)) {
		Write-LauncherLog "Starting Docker Desktop for auto-start containers."
		Start-Process -FilePath $dockerDesktop -WindowStyle Hidden | Out-Null
	}

	Write-LauncherLog "Waiting for Docker Desktop to restore the GatedSpace data containers."
	Wait-ForCondition -Condition {
		foreach ($port in $dataServicePorts) {
			if (-not (Test-LocalPort -Port $port)) {
				return $false
			}
		}
		return $true
	} -Description "auto-started GatedSpace data containers"
	Write-LauncherLog "All GatedSpace data container ports are ready."
}

function Start-DataServices {
	Write-LauncherLog "Starting Docker Compose project $composeProject."
	$previousErrorActionPreference = $ErrorActionPreference
	try {
		$ErrorActionPreference = "Continue"
		$output = & $dockerCli compose -p $composeProject -f $composeFile --env-file $envFile up -d 2>&1
		$exitCode = $LASTEXITCODE
	} finally {
		$ErrorActionPreference = $previousErrorActionPreference
	}
	foreach ($line in $output) {
		Write-LauncherLog "compose: $line"
	}
	if ($exitCode -ne 0) {
		throw "Docker Compose failed with exit code $exitCode."
	}
}

function Test-AllApplicationPorts {
	foreach ($port in $applicationPorts) {
		if (-not (Test-LocalPort -Port $port)) {
			return $false
		}
	}
	return $true
}

function Stop-StaleApplicationStack {
	$recordedRoot = $null
	if (Test-Path -LiteralPath $servicesPidFile) {
		try {
			$parts = (Get-Content -LiteralPath $servicesPidFile -Raw).Trim() -split "\|"
			if ($parts.Count -eq 2) {
				$process = Get-Process -Id ([int]$parts[0]) -ErrorAction Stop
				$recordedStartTime = [long]$parts[1]
				if (
					$process.ProcessName -eq "bun" -and
					$process.StartTime.ToFileTimeUtc() -eq $recordedStartTime
				) {
					$recordedRoot = $process
				}
			}
		} catch {
			$recordedRoot = $null
		}
	}
	if ($recordedRoot) {
		$roots = @($recordedRoot)
	} else {
		$portPattern = ($applicationPorts | ForEach-Object { [string]$_ }) -join "|"
		$ownerIds = @(
			foreach ($line in @(& netstat.exe -ano -p tcp)) {
				if (
					$line -match "^\s*TCP\s+\S+:(?:$portPattern)\s+\S+\s+LISTENING\s+(\d+)\s*$"
				) {
					[int]$Matches[1]
				}
			}
		) | Select-Object -Unique
		$ownerIds = @(
			$ownerIds
		)
		if ($ownerIds.Count -eq 0) {
			return
		}

		$processesById = @{}
		foreach ($process in @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)) {
			$processesById[[int]$process.ProcessId] = $process
		}

		$rootsById = @{}
		foreach ($ownerId in $ownerIds) {
			$currentId = [int]$ownerId
			$visited = @{}
			while ($currentId -gt 0 -and $processesById.ContainsKey($currentId)) {
				if ($visited.ContainsKey($currentId)) {
					break
				}
				$visited[$currentId] = $true

				$process = $processesById[$currentId]
				if (
					$process.Name -eq "bun.exe" -and
					$process.CommandLine -match "x\s+turbo\s+run\s+dev\s+dev:caddy"
				) {
					$rootsById[$currentId] = $process
					break
				}
				$currentId = [int]$process.ParentProcessId
			}
		}
		$roots = @($rootsById.Values)
	}

	foreach ($root in $roots) {
		$rootId = if ($root.PSObject.Properties.Name -contains "ProcessId") {
			[int]$root.ProcessId
		} else {
			[int]$root.Id
		}
		Write-LauncherLog "Stopping stale application stack process $rootId."
		$previousErrorActionPreference = $ErrorActionPreference
		try {
			$ErrorActionPreference = "Continue"
			& taskkill.exe /PID $rootId /T /F *> $null
		} finally {
			$ErrorActionPreference = $previousErrorActionPreference
		}
		for ($attempt = 0; $attempt -lt 20; $attempt++) {
			if (-not (Get-Process -Id $rootId -ErrorAction SilentlyContinue)) {
				break
			}
			Start-Sleep -Milliseconds 250
		}
		if (Get-Process -Id $rootId -ErrorAction SilentlyContinue) {
			throw "Could not stop stale application stack process $rootId."
		}
	}

	if ($roots.Count -gt 0) {
		Start-Sleep -Seconds 3
	}
}

function Start-ApplicationServices {
	if (Test-AllApplicationPorts) {
		Write-LauncherLog "Application services are already listening."
		return
	}

	Stop-StaleApplicationStack
	foreach ($path in @($servicesOutLog, $servicesErrLog)) {
		if (Test-Path -LiteralPath $path) {
			Remove-Item -LiteralPath $path -Force
		}
	}

	Write-LauncherLog "Starting API, web, Caddy, and Electric proxy."
	$arguments = @(
		"x",
		"turbo",
		"run",
		"dev",
		"dev:caddy",
		"--filter=@superset/api",
		"--filter=@superset/web",
		"--filter=electric-proxy",
		"--filter=//"
	)
	$startArguments = @{
		FilePath = $bun
		ArgumentList = $arguments
		WorkingDirectory = $RepoRoot
		WindowStyle = "Hidden"
		RedirectStandardOutput = $servicesOutLog
		RedirectStandardError = $servicesErrLog
		PassThru = $true
	}
	$process = Start-Process @startArguments
	$processRecord = "{0}|{1}" -f $process.Id, $process.StartTime.ToFileTimeUtc()
	Set-Content -LiteralPath $servicesPidFile -Value $processRecord
	Write-LauncherLog "Application stack process started as PID $($process.Id)."

	Wait-ForCondition -Condition { Test-AllApplicationPorts } -Description "GatedSpace application ports"
}

function Test-AuthenticationApi {
	try {
		$response = Invoke-WebRequest -Uri "http://localhost:3001/api/auth/get-session" -UseBasicParsing -TimeoutSec 5
		return $response.StatusCode -eq 200
	} catch {
		return $false
	}
}

function Start-GatedSpaceApp {
	param([bool]$RestartRunningApp = $false)

	if (-not $LaunchApp) {
		return
	}
	$runningProcesses = @(Get-Process -Name "GatedSpace" -ErrorAction SilentlyContinue)
	if ($runningProcesses.Count -gt 0 -and -not $RestartRunningApp) {
		Write-LauncherLog "GatedSpace is already running."
		return
	}
	if (-not (Test-Path -LiteralPath $gatedSpaceExe)) {
		throw "Installed GatedSpace executable was not found at $gatedSpaceExe."
	}
	if ($runningProcesses.Count -gt 0) {
		Write-LauncherLog "Restarting the early GatedSpace process now that local services are healthy."
		foreach ($process in $runningProcesses) {
			if ($process.MainWindowHandle -ne 0) {
				$null = $process.CloseMainWindow()
			}
		}
		Start-Sleep -Seconds 3
		Get-Process -Name "GatedSpace" -ErrorAction SilentlyContinue |
			Stop-Process -Force -ErrorAction SilentlyContinue
		Start-Sleep -Seconds 2
	}

	Write-LauncherLog "Launching installed GatedSpace application."
	Start-Process -FilePath $gatedSpaceExe | Out-Null
}

$requiredPaths = if ($AppOnly) {
	@($gatedSpaceExe)
} elseif ($UseDockerAutoStart) {
	@($dockerDesktop, $bun)
} else {
	@($dockerCli, $dockerDesktop, $bun, $composeFile, $envFile)
}
foreach ($requiredPath in $requiredPaths) {
	if (-not (Test-Path -LiteralPath $requiredPath)) {
		throw "Required GatedSpace dependency was not found: $requiredPath"
	}
}

$mutexName = if ($AppOnly) {
	"Local\GatedSpaceApplicationLauncher"
} else {
	"Local\GatedSpaceLocalStackLauncher"
}
$mutex = [System.Threading.Mutex]::new($false, $mutexName)
$ownsMutex = $false
try {
	$ownsMutex = $mutex.WaitOne(0)
	if (-not $ownsMutex) {
		Write-LauncherLog "Another startup instance is already running; exiting."
		exit 0
	}

	$startupMode = if ($AppOnly) {
		"application-only"
	} elseif ($UseDockerAutoStart) {
		"Docker auto-start"
	} else {
		"full stack"
	}
	Write-LauncherLog "Startup requested for $RepoRoot in $startupMode mode (compose project $composeProject)."
	$authenticationWasHealthyAtStart =
		(Test-AllApplicationPorts) -and (Test-AuthenticationApi)
	if ($UseDockerAutoStart) {
		Wait-ForAutoStartDataServices
		Start-ApplicationServices
	} elseif (-not $AppOnly) {
		Start-DockerEngine
		Start-DataServices
		Start-ApplicationServices
	}
	Wait-ForCondition -Condition { Test-AuthenticationApi } -Description "authentication API and database"
	Write-LauncherLog "All GatedSpace services are healthy."
	$restartRunningApp =
		$RestartAppAfterRecovery -and (-not $authenticationWasHealthyAtStart)
	Start-GatedSpaceApp -RestartRunningApp $restartRunningApp
} catch {
	Write-LauncherLog "ERROR: $($_.Exception.Message)"
	throw
} finally {
	if ($ownsMutex) {
		$mutex.ReleaseMutex()
	}
	$mutex.Dispose()
}
