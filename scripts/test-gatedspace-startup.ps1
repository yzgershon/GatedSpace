$ErrorActionPreference = 'Stop'
$sourcePath = Join-Path $PSScriptRoot 'start-gatedspace-local-stack.ps1'
$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($sourcePath, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count -gt 0) { throw 'Launcher syntax failed' }
$target = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Wait-ForAutoStartDataServices' }, $true)
. ([scriptblock]::Create($target.Extent.Text))
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
if ($script:repairs -ne 1 -or $script:engine -ne 1) { throw 'Missing data services not repaired' }
Wait-ForAutoStartDataServices
if ($script:repairs -ne 1) { throw 'Healthy services restarted unnecessarily' }
'PASS launcher parses, missing data services repaired, healthy containers left running; no real services started or stopped.'
