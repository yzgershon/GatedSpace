param([string]$Version, [string]$Stage)
$ErrorActionPreference = 'Stop'
$icon = $null
try {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    $icon = New-Object System.Windows.Forms.NotifyIcon
    $icon.Icon = [System.Drawing.SystemIcons]::Information
    $icon.Text = 'GatedSpace installer build'
    $icon.BalloonTipTitle = "GatedSpace personal $Version"
    $icon.BalloonTipText = if ($Stage -eq 'ready') { 'Your personal installer is verified and ready. Use Update when you are ready to restart.' } else { 'The installer needs attention. Open the build indicator for the failed step. Completed build steps are saved.' }
    $icon.Visible = $true
    $icon.ShowBalloonTip(15000)
    $until = [DateTime]::UtcNow.AddSeconds(15)
    while ([DateTime]::UtcNow -lt $until) {
        [System.Windows.Forms.Application]::DoEvents()
        Start-Sleep -Milliseconds 100
    }
} finally {
    if ($icon) { $icon.Visible = $false; $icon.Dispose() }
}
