export type SetupAgent = "codex" | "claude";

/** Fixed, first-party installers; run only after the user chooses Install.
 * The terminal owns browser login, so no Electron OAuth deep link is needed. */
export function agentSetupCommand(agent: SetupAgent, install: boolean): string {
	const url =
		agent === "codex"
			? "https://chatgpt.com/codex/install.ps1"
			: "https://claude.ai/install.ps1";
	const script = `
$ErrorActionPreference = 'Stop'
try {
 ${install ? `Invoke-RestMethod '${url}' | Invoke-Expression` : ""}
 $setupPath = @([Environment]::GetEnvironmentVariable('Path','User'), [Environment]::GetEnvironmentVariable('Path','Machine'), $env:PATH) -join ';'
 $env:PATH = ((@((Join-Path $env:USERPROFILE '.local\\bin')) + ($setupPath -split ';')) | Where-Object { $_ -and $_ -notmatch '[\\\\/]\\.superset[\\\\/]bin[\\\\/]?$' } | Select-Object -Unique) -join ';'
 $agentExe = (Get-Command '${agent}' -CommandType Application -ErrorAction Stop).Source
 & $agentExe ${agent === "codex" ? "login" : "auth login"}
 if ($LASTEXITCODE -ne 0) { throw 'Sign-in did not complete. Retry sign-in when ready.' }
 Write-Host 'Sign-in finished. Close this panel and open your agent.' -ForegroundColor Green
} catch { Write-Host $_.Exception.Message -ForegroundColor Red }
`;
	// EncodedCommand works from PowerShell, cmd and Git Bash without shell quoting.
	const bytes = new Uint8Array(script.length * 2);
	for (let i = 0; i < script.length; i++) {
		bytes[i * 2] = script.charCodeAt(i) & 255;
		bytes[i * 2 + 1] = script.charCodeAt(i) >> 8;
	}
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return `powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${btoa(binary)}`;
}
