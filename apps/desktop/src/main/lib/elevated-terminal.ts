/**
 * "Run as administrator" — as a separate window, deliberately, not as a pane.
 *
 * The obvious feature request is an elevated shell INSIDE a pane, and it is not
 * safely buildable. Two facts decide it:
 *
 * 1. Spawning an elevated process needs `ShellExecuteEx` with the `runas` verb,
 *    and that call cannot carry `PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE`. So an
 *    elevated child cannot be attached to a ConPTY we own. There is no direct
 *    route from "our PTY" to "an admin shell".
 * 2. The workaround — an elevated broker that owns the ConPTY on its side and
 *    relays bytes back over a named pipe — hands an UNELEVATED process a
 *    keyboard into an elevated shell. That is a UAC bypass primitive: anything
 *    running as the user could drive admin commands with no consent prompt. It
 *    would be a hole in the app, not a feature of it.
 *
 * Windows Terminal reached the same conclusion and opens elevated profiles in
 * their own elevated window rather than mixing elevation levels in one process.
 * This does that: Windows shows the UAC prompt, the admin shell is a real
 * console window that says "Administrator" in its title bar, and GatedSpace
 * never sits in the middle of it.
 *
 * The inner command is passed as `-EncodedCommand` (base64 UTF-16LE), so the
 * working directory — a path the user chose, which may contain quotes — cannot
 * break out into the launching command line.
 */
import { spawn } from "node:child_process";

export const ELEVATION_UNSUPPORTED_MESSAGE =
	"Opening a terminal as administrator is a Windows-only feature. On macOS " +
	"and Linux, run `sudo` in the pane you already have — it prompts in-band, " +
	"so there is nothing to launch.";

export const ELEVATION_DECLINED_MESSAGE =
	"Windows declined the elevation prompt, so nothing was opened.";

/**
 * Distinct from any exit code PowerShell produces on its own, so a cancelled
 * UAC prompt is reported as a choice rather than a failure.
 */
export const ELEVATION_DECLINED_EXIT_CODE = 5;

/** PowerShell's `-EncodedCommand` reads base64 of UTF-16LE, not UTF-8. */
export function encodePowerShellCommand(script: string): string {
	return Buffer.from(script, "utf16le").toString("base64");
}

/**
 * The script the ELEVATED shell runs first.
 *
 * `Test-Path` before `Set-Location` because a worktree can be deleted between
 * opening the menu and clicking it, and a fresh admin window opening onto a red
 * error is a worse answer than one that opens in the default directory.
 */
export function buildElevatedInnerScript(cwd: string): string {
	if (!cwd.trim()) return "";
	// Single quotes are PowerShell's literal string; '' is the only escape inside
	// one, which makes this total rather than a blocklist.
	const quoted = cwd.replaceAll("'", "''");
	return `$p = '${quoted}'; if (Test-Path -LiteralPath $p) { Set-Location -LiteralPath $p }`;
}

/**
 * Args for the UNELEVATED launcher, whose only job is to make the `runas` call.
 *
 * Everything variable is base64 by the time it reaches this string, so the
 * command line is fixed text plus `[A-Za-z0-9+/=]`.
 */
export function buildElevatedLauncherArgs(cwd: string): string[] {
	const inner = buildElevatedInnerScript(cwd);
	const shellArgs = inner
		? `'-NoLogo','-NoExit','-EncodedCommand','${encodePowerShellCommand(inner)}'`
		: `'-NoLogo','-NoExit'`;

	const launcher =
		`try { Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList ${shellArgs} } ` +
		`catch { exit ${ELEVATION_DECLINED_EXIT_CODE} }`;

	return ["-NoProfile", "-NonInteractive", "-Command", launcher];
}

export interface ElevatedTerminalResult {
	ok: boolean;
	error?: string;
}

/**
 * Resolves as soon as the elevation request is answered, not when the admin
 * window closes — the launcher exits the moment `Start-Process` returns, so a
 * cancelled prompt comes back immediately instead of hanging the caller for as
 * long as someone leaves the window open.
 */
export function openElevatedTerminal(
	cwd: string,
	platform: NodeJS.Platform = process.platform,
): Promise<ElevatedTerminalResult> {
	if (platform !== "win32") {
		return Promise.resolve({ ok: false, error: ELEVATION_UNSUPPORTED_MESSAGE });
	}

	return new Promise((resolve) => {
		const child = spawn("powershell.exe", buildElevatedLauncherArgs(cwd), {
			// The launcher itself is plumbing; only the elevated window it starts
			// should ever be visible.
			windowsHide: true,
			stdio: "ignore",
		});

		child.on("error", (error) => {
			resolve({
				ok: false,
				error:
					error instanceof Error
						? error.message
						: "Could not start the elevation prompt",
			});
		});

		child.on("exit", (code) => {
			if (code === ELEVATION_DECLINED_EXIT_CODE) {
				resolve({ ok: false, error: ELEVATION_DECLINED_MESSAGE });
				return;
			}
			if (code !== 0) {
				resolve({
					ok: false,
					error: `The elevation prompt failed (exit ${code}).`,
				});
				return;
			}
			resolve({ ok: true });
		});
	});
}
