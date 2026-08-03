// Directories that must never become a project root.
//
// Write confinement in workspace-fs is relative to the workspace ROOT, which
// is solid — but the root is whatever `initGitAndOpen` / `openFromPath` were
// handed, and both take a bare z.string(). Choosing the root therefore walks
// around the confinement rather than breaking it: point it at a system
// directory and every "confined" write lands there.
//
// This is a denylist rather than an allowlist on purpose. A project can live
// anywhere a person keeps code, so enumerating the good locations is not
// possible; enumerating the ones that are never a code directory is.
//
// The home directory is deliberately still allowed — a dotfiles repo at ~ is a
// real pattern, and refusing it would break a legitimate workflow to close a
// hole that already requires script execution inside the renderer.
//
// Kept free of trpc/electron imports so it can be unit tested.

import { parse, resolve, sep } from "node:path";

export type ProjectRootRejection = "filesystem-root" | "system-directory";

function normalise(candidate: string): string {
	return resolve(candidate)
		.replace(/[\\/]+$/, "")
		.toLowerCase();
}

/** `C:\`, `D:\`, `/` — a git repo spanning a whole volume is never intended. */
function isFilesystemRoot(candidate: string): boolean {
	const resolved = resolve(candidate);
	return resolved === parse(resolved).root;
}

/**
 * Env-var driven so this works on a machine where Windows is not on C:.
 * Values are compared as prefixes, so subdirectories are covered too.
 */
function systemRoots(env: NodeJS.ProcessEnv): string[] {
	const raw = [
		env.SystemRoot,
		env.windir,
		env.ProgramFiles,
		env["ProgramFiles(x86)"],
		env.ProgramData,
		// The app's own state: git-initialising it would put worktrees, tokens
		// and terminal logs under version control.
		env.SUPERSET_HOME_DIR,
	];
	if (process.platform !== "win32") {
		raw.push("/etc", "/usr", "/bin", "/sbin", "/System", "/Library");
	}
	return raw.filter((value): value is string => Boolean(value)).map(normalise);
}

export function checkProjectRoot(
	candidate: string,
	env: NodeJS.ProcessEnv = process.env,
): ProjectRootRejection | null {
	if (!candidate.trim()) return "filesystem-root";
	if (isFilesystemRoot(candidate)) return "filesystem-root";

	const target = normalise(candidate);
	for (const root of systemRoots(env)) {
		if (target === root || target.startsWith(root + sep.toLowerCase())) {
			return "system-directory";
		}
	}
	return null;
}

export function describeProjectRootRejection(
	reason: ProjectRootRejection,
	candidate: string,
): string {
	if (reason === "filesystem-root") {
		return `Refusing to use a whole volume as a project (got ${JSON.stringify(candidate)}).`;
	}
	return `Refusing to use a system directory as a project (got ${JSON.stringify(candidate)}).`;
}
