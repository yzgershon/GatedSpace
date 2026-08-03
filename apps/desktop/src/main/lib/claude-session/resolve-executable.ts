/**
 * Resolves the claude binary to something spawnable without a shell.
 *
 * `spawn("claude", args, { shell: true })` was fine while every argument came
 * from this codebase. It stopped being fine once agent presets started feeding
 * user-configured args into argv: with a shell, `&&`, `|` and friends inside an
 * argument are interpreted rather than passed through, and Node warns about
 * exactly this (DEP0190) because it concatenates instead of escaping.
 *
 * On Windows `claude` may be a real `.exe` or an npm `.cmd` shim. An `.exe` can
 * be spawned directly — no shell, no interpretation, arguments passed through
 * verbatim. A `.cmd` genuinely cannot: since the Node fix for CVE-2024-27980,
 * batch files only run through a shell. So we resolve PATH ourselves, prefer
 * the directly-spawnable form, and fall back to a shell only when the shim is
 * all there is.
 */
import { existsSync } from "node:fs";
import { delimiter, isAbsolute, join, sep } from "node:path";

export interface ResolvedExecutable {
	/** What to hand to spawn(). */
	command: string;
	/** True only when the resolved target can't run without a shell. */
	needsShell: boolean;
}

/** Extensions that spawn directly, in preference order, then the ones that can't. */
const DIRECT_EXTS = [".exe", ".com"];
const SHELL_EXTS = [".cmd", ".bat"];

export interface ResolveOptions {
	pathDirs?: string[];
	isWindows?: boolean;
	exists?: (candidate: string) => boolean;
}

function looksLikePath(binary: string): boolean {
	return binary.includes("/") || binary.includes(sep) || isAbsolute(binary);
}

/**
 * What to return when nothing was found.
 *
 * This used to be `{ needsShell: true }`, with the reasoning that the shell
 * would "produce the real error". It did — but it also made every unresolvable
 * binary a shell command line. `binary` arrives from the tRPC start input as a
 * bare string, so a value like `x & calc.exe` resolves to nothing, gets handed
 * to cmd.exe, and runs as two commands.
 *
 * Spawning it directly fails with ENOENT instead, which is a better error
 * anyway: it names the thing that was missing rather than whatever a shell
 * makes of it. A shell is still used for a `.cmd`/`.bat` shim, but only after
 * tryCandidate has confirmed that file actually exists.
 */
function notFound(binary: string): ResolvedExecutable {
	return { command: binary, needsShell: false };
}

export function resolveExecutable(
	binary: string,
	options: ResolveOptions = {},
): ResolvedExecutable {
	const isWindows = options.isWindows ?? process.platform === "win32";
	const exists = options.exists ?? existsSync;

	// Everywhere else, an executable on PATH spawns directly as-is.
	if (!isWindows) return { command: binary, needsShell: false };

	const tryCandidate = (base: string): ResolvedExecutable | null => {
		for (const ext of DIRECT_EXTS) {
			if (exists(base + ext)) return { command: base + ext, needsShell: false };
		}
		if (exists(base)) {
			const lower = base.toLowerCase();
			const needsShell = SHELL_EXTS.some((ext) => lower.endsWith(ext));
			return { command: base, needsShell };
		}
		for (const ext of SHELL_EXTS) {
			if (exists(base + ext)) return { command: base + ext, needsShell: true };
		}
		return null;
	};

	// An explicit path is used as given — the user pointed at something specific.
	if (looksLikePath(binary)) {
		return tryCandidate(binary) ?? notFound(binary);
	}

	const pathDirs =
		options.pathDirs ??
		(process.env.PATH ?? "").split(delimiter).filter(Boolean);
	// PATH order decides which directory wins; within a directory we prefer the
	// form that doesn't need a shell.
	for (const dir of pathDirs) {
		const found = tryCandidate(join(dir, binary));
		if (found) return found;
	}

	return notFound(binary);
}
