import os from "node:os";
import path from "node:path";

type ShellEnvSource = Record<string, string | undefined>;

export interface ResolveConfiguredShellOptions {
	platform?: NodeJS.Platform;
	/**
	 * Test override. `undefined` probes the OS account; `null` simulates an
	 * unavailable account shell and falls back to env.
	 */
	accountShell?: string | null;
}

function normalizeShellPath(value: unknown): string | null {
	return typeof value === "string" && value.trim().length > 0
		? value.trim()
		: null;
}

/**
 * Windows env names are case-insensitive and it spells this one `ComSpec`.
 * `process.env` honours that; a PLAIN OBJECT snapshot of process.env does not —
 * and the terminal base env is exactly such a snapshot. So `env.COMSPEC` missed
 * every single time on Windows and every terminal launched with a bare
 * "cmd.exe" instead of the real path. See resolveWindowsShell for why that then
 * failed outright.
 */
function lookupIgnoreCase(env: ShellEnvSource, name: string): string | null {
	const direct = normalizeShellPath(env[name]);
	if (direct) return direct;

	const wanted = name.toLowerCase();
	for (const key of Object.keys(env)) {
		if (key.toLowerCase() !== wanted) continue;
		const value = normalizeShellPath(env[key]);
		if (value) return value;
	}
	return null;
}

/**
 * Absolute wherever we can manage it, because a relative shell is a trap on
 * Windows: node-pty resolves the name itself, and its resolver
 * (path_util.cc `get_shell_path`) returns an EMPTY string when the name also
 * matches something in the CALLING process's working directory. A pty-daemon
 * that inherited C:\Windows\System32 as its cwd therefore fails every single
 * "cmd.exe" spawn with `File not found: ` — nothing after the colon, because
 * the path it's complaining about is the empty one it just produced.
 *
 * An absolute path skips that resolver entirely (`PathIsRelativeW` is false),
 * so the whole failure mode goes away.
 *
 * path.win32 rather than path: the platform is a parameter here, so this has to
 * behave the same when a non-Windows machine asks about win32.
 */
function resolveWindowsShell(env: ShellEnvSource): string {
	const comspec = lookupIgnoreCase(env, "COMSPEC");
	if (comspec && path.win32.isAbsolute(comspec)) return comspec;

	const systemRoot =
		lookupIgnoreCase(env, "SystemRoot") ?? lookupIgnoreCase(env, "windir");
	if (systemRoot && path.win32.isAbsolute(systemRoot)) {
		return path.win32.join(systemRoot, "System32", "cmd.exe");
	}

	// Nothing left to anchor to. Fall back to the bare name we used to return —
	// it's the broken case, but inventing a drive letter would be worse.
	return comspec ?? "cmd.exe";
}

export function getAccountShell(
	platform: NodeJS.Platform = process.platform,
): string | null {
	if (platform === "win32") return null;

	try {
		const shell = (os.userInfo() as { shell?: unknown }).shell;
		return normalizeShellPath(shell);
	} catch {
		return null;
	}
}

let accountShellForTesting: string | null | undefined;

export function __setAccountShellForTesting(
	shell: string | null | undefined,
): void {
	accountShellForTesting = shell;
}

/**
 * Resolve the shell Superset should launch for user terminals.
 *
 * Desktop-launched helper processes can inherit a generic SHELL such as
 * /bin/bash even when the user's configured login shell is fish. Prefer the
 * OS account shell to match normal terminal-app behavior and the old v1 path.
 */
export function resolveConfiguredShell(
	env: ShellEnvSource,
	options: ResolveConfiguredShellOptions = {},
): string {
	const platform = options.platform ?? process.platform;

	if (platform === "win32") {
		return resolveWindowsShell(env);
	}

	const accountShell =
		options.accountShell === undefined
			? accountShellForTesting === undefined
				? getAccountShell(platform)
				: normalizeShellPath(accountShellForTesting)
			: normalizeShellPath(options.accountShell);

	return accountShell ?? normalizeShellPath(env.SHELL) ?? "/bin/sh";
}
