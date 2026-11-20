import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { stripVTControlCharacters } from "node:util";
import { resolveNativeClaude } from "../claude-session/resolve-native";

export interface ClaudeLoginProgress {
	authUrl?: string;
	acceptsCode?: boolean;
}
export function claudeAuthUrl(value: string): string | undefined {
	try {
		const url = new URL(value);
		if (
			url.protocol === "https:" &&
			!url.username &&
			!url.password &&
			!url.port &&
			[
				"claude.ai",
				"claude.com",
				"console.anthropic.com",
				"platform.claude.com",
			].includes(url.hostname) &&
			/\/(oauth|authorize)(\/|$)/.test(url.pathname)
		)
			return url.href;
	} catch {
		/* Only URLs emitted by the official CLI are considered. */
	}
}

/** Keeps the CLI's browser/code handshake alive without exposing terminal output. */
export class ClaudeBrowserLogin {
	private child?: ChildProcessWithoutNullStreams;
	private buffer = "";
	private acceptsCode = false;
	private cancelled = false;
	constructor(
		private readonly home: string,
		private readonly progress: (value: ClaudeLoginProgress) => void,
		private readonly launch = (args: string[], home: string) => {
			const executable = resolveNativeClaude();
			const env: NodeJS.ProcessEnv = {
				...process.env,
				...executable.env,
				CLAUDE_CONFIG_DIR: home,
			};
			delete env.ANTHROPIC_API_KEY;
			delete env.CLAUDE_CODE_OAUTH_TOKEN;
			return spawn(executable.command, [...executable.args, "auth", ...args], {
				env,
				stdio: "pipe",
				windowsHide: true,
				shell: false,
			});
		},
	) {}
	cancel() {
		this.cancelled = true;
		this.child?.kill();
	}
	submitCode(code: string) {
		if (this.cancelled || !this.acceptsCode || !this.child?.stdin.writable)
			throw new Error(
				"This sign-in is not waiting for a code. Start a new sign-in.",
			);
		const value = code.trim();
		if (
			!value ||
			value.length > 8_000 ||
			/\s/.test(value) ||
			[...value].some(
				(character) =>
					character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
			)
		)
			throw new Error("Paste only the code from the current browser sign-in.");
		this.acceptsCode = false;
		this.buffer = "";
		this.progress({ acceptsCode: false });
		this.child.stdin.write(`${value}\n`);
	}
	private observe = (chunk: Buffer) => {
		if (this.cancelled) return;
		this.buffer = (
			this.buffer + stripVTControlCharacters(chunk.toString())
		).slice(-32_000);
		for (const match of this.buffer.matchAll(/https:\/\/[^\s<>"']+(?=\s)/g)) {
			const authUrl = claudeAuthUrl(match[0]);
			if (authUrl) this.progress({ authUrl });
		}
		if (/paste[^\n]{0,100}code|enter[^\n]{0,80}code/i.test(this.buffer)) {
			this.acceptsCode = true;
			this.progress({ acceptsCode: true });
		}
	};
	private wait(child: ChildProcessWithoutNullStreams) {
		return new Promise<void>((resolve, reject) => {
			child.once("error", reject);
			// A closed input pipe must fail the login, never crash the main process.
			child.stdin.once("error", reject);
			// close follows stdio drainage; exit can precede the final auth-status JSON.
			child.once("close", (code) =>
				code === 0
					? resolve()
					: reject(new Error("Sign-in did not complete. Try again.")),
			);
		});
	}
	async run() {
		this.child = this.launch(["login", "--claudeai"], this.home);
		this.child.stdout.on("data", this.observe);
		this.child.stderr.on("data", this.observe);
		await this.wait(this.child);
		if (this.cancelled) return;
		this.acceptsCode = false;
		this.progress({ acceptsCode: false });
		this.child = this.launch(["status", "--json"], this.home);
		let output = "";
		this.child.stdout.on("data", (chunk) => {
			output = (output + chunk.toString()).slice(-64_000);
		});
		this.child.stderr.resume();
		await this.wait(this.child);
		if (!JSON.parse(output).loggedIn)
			throw new Error("Sign-in could not be verified. Try again.");
	}
}
