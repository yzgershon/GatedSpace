import { execFile } from "node:child_process";
import { promisify } from "node:util";
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
	return { codex, claude };
}
