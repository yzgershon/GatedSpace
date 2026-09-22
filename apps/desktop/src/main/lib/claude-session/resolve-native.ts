import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { type ResolveOptions, resolveExecutable } from "./resolve-executable";

/** Native sessions must bypass the interactive Git Bash wrappers. JSON argv
 * cannot survive cmd -> bash quoting, and neither shell owns this process. */
export function resolveNativeClaude(
	binary = "claude",
	options: ResolveOptions & { home?: string; execPath?: string } = {},
) {
	const exists = options.exists ?? existsSync;
	const isWindows = options.isWindows ?? process.platform === "win32";
	const pathDirs = (
		options.pathDirs ?? (process.env.PATH ?? "").split(delimiter)
	).filter((dir) => dir && !/[\\/]\.superset[\\/]bin[\\/]?$/i.test(dir));
	// claude-acct is the legacy account-selection wrapper. This transport already
	// binds CLAUDE_CONFIG_DIR with the same profile resolver, including pane pins.
	// Running the wrapper would override that binding and print a non-JSON banner.
	// Only translate the known alias or its managed path, never arbitrary scripts.
	const accountWrapper =
		isWindows &&
		(/^claude-acct(?:\.cmd)?$/i.test(binary) ||
			resolve(binary).toLowerCase() ===
				resolve(
					options.home ?? homedir(),
					".superset",
					"bin",
					"claude-acct.cmd",
				).toLowerCase());
	const bare = accountWrapper || /^claude(?:\.exe|\.cmd)?$/i.test(binary);
	if (isWindows && bare) {
		for (const dir of [
			...pathDirs,
			join(options.home ?? homedir(), ".local", "bin"),
		]) {
			const command = join(dir, "claude.exe");
			if (exists(command)) return { command, args: [] as string[], env: {} };
		}
	}
	const resolved = resolveExecutable(bare ? "claude" : binary, {
		...options,
		pathDirs,
	});
	if (!resolved.needsShell)
		return { command: resolved.command, args: [] as string[], env: {} };
	const entry = join(
		dirname(resolved.command),
		"node_modules",
		"@anthropic-ai",
		"claude-code",
		"cli.js",
	);
	if (exists(entry))
		return {
			command: options.execPath ?? process.execPath,
			args: [entry],
			env: { ELECTRON_RUN_AS_NODE: "1" },
		};
	throw new Error(
		"Native Claude sessions require claude.exe or the Claude Code npm installation. Select the executable instead of a shell wrapper in the agent preset.",
	);
}
