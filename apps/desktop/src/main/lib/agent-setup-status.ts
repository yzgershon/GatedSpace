import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { codexProfiles } from "./agent-accounts/codex-profiles";
import { getClaudeProfile } from "./claude-profile";
import { resolveNativeClaude } from "./claude-session/resolve-native";
import { resolveCodexExecutable } from "./codex-session/transport";
import { augmentWindowsRuntimePath } from "./windows-runtime-path";

export async function agentSetupStatus() {
	augmentWindowsRuntimePath(process.env);
	const check = async (resolve: typeof resolveCodexExecutable) => {
		try {
			const executable = resolve();
			await promisify(execFile)(
				executable.command,
				[...executable.args, "--version"],
				{
					env: { ...process.env, ...executable.env },
					windowsHide: true,
					timeout: 8_000,
				},
			);
			return true;
		} catch {
			return false;
		}
	};
	const [codex, claude] = await Promise.all([
		check(resolveCodexExecutable),
		check(() => resolveNativeClaude()),
	]);
	const account = async (agent: "codex" | "claude", installed: boolean) => {
		if (!installed) return { signedIn: false, nickname: null };
		try {
			const profiles = agent === "claude" ? getClaudeProfile() : null;
			const profile = profiles?.profiles.find(
				(p) => p.id === profiles.activeProfileId,
			);
			const codexProfile =
				agent === "codex" ? codexProfiles.get(codexProfiles.resolve()) : null;
			const executable =
				agent === "codex" ? resolveCodexExecutable() : resolveNativeClaude();
			const env: NodeJS.ProcessEnv = {
				...process.env,
				...executable.env,
				...(profile ? { CLAUDE_CONFIG_DIR: profile.configDir } : {}),
				...(codexProfile ? { CODEX_HOME: codexProfile.home } : {}),
			};
			delete env.ANTHROPIC_API_KEY;
			delete env.CLAUDE_CODE_OAUTH_TOKEN;
			delete env.OPENAI_API_KEY;
			delete env.CODEX_API_KEY;
			const { stdout } = await promisify(execFile)(
				executable.command,
				[
					...executable.args,
					...(agent === "claude"
						? ["auth", "status", "--json"]
						: ["login", "status"]),
				],
				{ env, windowsHide: true, timeout: 8_000 },
			);
			const signedIn =
				agent === "codex" || JSON.parse(stdout).loggedIn === true;
			return {
				signedIn,
				nickname: signedIn
					? (profile?.label ?? codexProfile?.label ?? null)
					: null,
			};
		} catch {
			return { signedIn: false, nickname: null };
		}
	};
	const [codexAccount, claudeAccount] = await Promise.all([
		account("codex", codex),
		account("claude", claude),
	]);
	return {
		codex,
		claude,
		accounts: { codex: codexAccount, claude: claudeAccount },
	};
}
