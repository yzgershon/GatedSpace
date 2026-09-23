import { expect, test } from "bun:test";
import { displayCommand } from "./command";

test("Windows shell wrappers reveal the submitted script without altering execution data", () => {
	const script = 'Get-Content "my file.ts"; Write-Output "done"';
	const command = `"C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -Command ${JSON.stringify(script)}`;
	expect(displayCommand(command)).toBe(script);
	expect(command).toContain("powershell.exe");
	expect(
		displayCommand(
			`"C:\\Program Files\\PowerShell\\7\\pwsh.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -Command ${JSON.stringify(script)}`,
		),
	).toBe(script);
});

test("multiline scripts, here-strings and quotes stay readable", () => {
	const script = "@'\nfrom pathlib import Path\nprint('hello')\n'@ | python -";
	expect(displayCommand(`powershell.exe -Command "${script}"`)).toBe(script);
	expect(displayCommand(`pwsh -Command ${JSON.stringify(script)}`)).toBe(
		script,
	);
	expect(displayCommand("pwsh -Command 'git status --short'")).toBe(
		"git status --short",
	);
});

test("unrecognized wrappers and file invocations remain verbatim", () => {
	for (const raw of [
		"git status --short",
		'echo "pwsh -Command git status"',
		"powershell -File build.ps1",
		"pwsh -EncodedCommand ZWNobyB0ZXN0",
		"pwsh -CommandWithArgs hello x",
	]) {
		expect(displayCommand(raw)).toBe(raw);
	}
});
