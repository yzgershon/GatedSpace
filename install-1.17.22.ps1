# Installs the 1.17.22 personal build and brings GatedSpace back up.
#
# Run DETACHED. It has to close GatedSpace, and the agent asking for the install
# is itself a child of GatedSpace — anything running inside the app dies partway
# through the job it was sent to do.
#
# Every step is logged, because the person who asked for this is not at the
# machine and the only evidence they will have is this file.

$ErrorActionPreference = 'Continue'
$log = Join-Path $env:TEMP 'gatedspace-install.log'

function Log($message) {
    "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $message" |
        Out-File -FilePath $log -Append -Encoding utf8
}

$installer = 'C:\Dev\superset\apps\desktop\release-122\GatedSpace-personal-1.17.22-arm64.exe'
$exe = Join-Path $env:LOCALAPPDATA 'Programs\GatedSpace\GatedSpace.exe'

Log '--- install 1.17.22 ---'

if (-not (Test-Path $installer)) {
    Log "ABORT: installer not found at $installer"
    Log 'GatedSpace was left running.'
    exit 1
}

# A breath before pulling the floor out, so the message explaining this has
# reached the phone.
Start-Sleep -Seconds 6

# Ask first, then insist. CloseMainWindow lets Electron run its own shutdown —
# which is what stops the Tailscale serve config being left pointing at a dead
# port.
Log 'closing GatedSpace'
Get-Process GatedSpace -ErrorAction SilentlyContinue | ForEach-Object {
    try { $null = $_.CloseMainWindow() } catch {}
}
Start-Sleep -Seconds 6
Get-Process GatedSpace -ErrorAction SilentlyContinue | ForEach-Object {
    try { Stop-Process -Id $_.Id -Force -ErrorAction Stop } catch {}
}
Start-Sleep -Seconds 3

$left = @(Get-Process GatedSpace -ErrorAction SilentlyContinue).Count
Log "processes still up: $left"

# /S is NSIS silent. Without it the installer waits on a wizard nobody is there
# to click.
Log 'running installer'
try {
    $proc = Start-Process -FilePath $installer -ArgumentList '/S' -PassThru -Wait -ErrorAction Stop
    Log "installer exit code: $($proc.ExitCode)"
} catch {
    Log "installer failed to run: $($_.Exception.Message)"
}

Start-Sleep -Seconds 8

if (Test-Path $exe) {
    try {
        Start-Process -FilePath $exe -ErrorAction Stop
        Log 'launched GatedSpace'
    } catch {
        Log "could not launch: $($_.Exception.Message)"
    }
} else {
    Log "MISSING: $exe — nothing to launch"
}

Start-Sleep -Seconds 20
$running = @(Get-Process GatedSpace -ErrorAction SilentlyContinue).Count
Log "GatedSpace processes after launch: $running"

# The bridge should have come back by itself in this build. Recording what
# Tailscale thinks is the difference between "the phone will work" and "find out
# by trying it".
try {
    $serve = (& tailscale serve status 2>&1 | Out-String).Trim()
    Log "tailscale serve: $serve"
} catch {
    Log 'tailscale serve status unavailable'
}

Log '--- done ---'
