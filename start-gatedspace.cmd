@echo off
title GatedSpace local stack

cd /d C:\Dev\Superset
echo [gatedspace] Starting Docker, data services, application services, and GatedSpace...

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-gatedspace-local-stack.ps1" -UseDockerAutoStart -LaunchApp -RestartAppAfterRecovery
if errorlevel 1 (
	echo [gatedspace] Startup failed. See %%LOCALAPPDATA%%\GatedSpace\logs\local-stack-launcher.log
	pause
	exit /b 1
)

echo [gatedspace] GatedSpace is ready.
