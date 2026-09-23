/** Display the submitted script, retaining the original command separately for auditing. */
export function displayCommand(command: string): string {
	const shell =
		/^(?:"[^"\r\n]*[\\/](?:powershell|pwsh)(?:\.exe)?"|'[^'\r\n]*[\\/](?:powershell|pwsh)(?:\.exe)?'|(?:[\w.:\\/-]*[\\/])?(?:powershell|pwsh)(?:\.exe)?)\s+(?:(?:-NoLogo|-NoProfile|-NonInteractive|-ExecutionPolicy\s+\w+)\s+)*-Command\s+([\s\S]+)$/i.exec(
			command.trim(),
		);
	if (!shell) return command;
	let script = shell[1].trim();
	if (script.startsWith('"') && script.endsWith('"')) {
		// The app-server displays argv with JSON-style escaping on Windows.
		try {
			const decoded: unknown = JSON.parse(script);
			if (typeof decoded === "string") return decoded;
		} catch {
			/* Literal newlines in the displayed argv are not JSON. */
		}
		script = script.slice(1, -1).replace(/\\"/g, '"');
	} else if (script.startsWith("'") && script.endsWith("'")) {
		script = script.slice(1, -1).replace(/'\\''/g, "'");
	}
	return script;
}
