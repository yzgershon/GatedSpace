/** Launching an agent is not its first task. The transcript supplies that later. */
export function isAgentLaunch(command: string) {
	return /\b(?:claude(?:-acct)?|codex|gemini|copilot|opencode)(?:\.exe|\.cmd)?(?:\s|$|["'])/i.test(
		command,
	);
}
export function terminalNamingPrompt(command: string): string | null {
	const text = command.trim();
	if (
		!text ||
		text.length > 12_000 ||
		isAgentLaunch(text) ||
		text.startsWith("/") ||
		/(?:password|secret|token|api[_-]?key|credential|\blogin\b|\bauth\b|=)/i.test(
			text,
		)
	)
		return null;
	return text;
}

/** Only the first submitted line in a newly created shell, never arbitrary terminal input. */
export class FirstTerminalCommand {
	private text = "";
	private done = false;
	take(data: string): string | undefined {
		if (this.done) return;
		// Cursor movement, completion and full-screen editors cannot be reconstructed safely.
		if (data.includes("\x1b") || data.includes("\t")) {
			this.done = true;
			this.text = "";
			return;
		}
		for (const char of data) {
			if (char === "\r" || char === "\n") {
				if (!this.text.trim()) continue;
				this.done = true;
				const text = this.text;
				this.text = "";
				return terminalNamingPrompt(text) ?? undefined;
			}
			if (char === "\x7f" || char === "\b") this.text = this.text.slice(0, -1);
			else if (char === "\x03" || char === "\x15") this.text = "";
			else if (char >= " ") this.text += char;
			if (this.text.length > 12_000) {
				this.done = true;
				this.text = "";
				return;
			}
		}
	}
	get finished() {
		return this.done;
	}
}
