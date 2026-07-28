import type { ExternalWorktree } from "./git";

interface SelectArgs {
	mainRepoPath: string;
	/** When provided, only worktrees whose path is in this set are returned. */
	requested?: Set<string>;
}

/**
 * Compare two paths that came from different places.
 *
 * On Windows `git worktree list --porcelain` reports POSIX separators
 * (`C:/Users/me/repo`) while everything originating in Node — the project row,
 * a path the user picked — uses backslashes. An exact `===` therefore compares
 * two spellings of the SAME directory and concludes they are different, which
 * silently inverted both filters below: nothing matched `requested` so an
 * explicit import selected nothing, and the main repo never matched
 * `mainRepoPath` so it was eligible for import as if it were a worktree.
 *
 * Windows only. On POSIX a backslash is a legal filename character and paths
 * are case-sensitive, so folding either would make distinct paths compare
 * equal — a worse bug than the one being fixed.
 */
function canonicalPath(value: string): string {
	if (process.platform !== "win32") return value;
	return value.replaceAll("\\", "/").toLowerCase();
}

/**
 * Apply the same filter rules used when bulk-importing external worktrees:
 * skip the main repo, bare/detached worktrees, and branch-less worktrees. When
 * `requested` is provided, also skip worktrees not in that set.
 */
export function selectExternalWorktreesForImport(
	worktrees: ExternalWorktree[],
	{ mainRepoPath, requested }: SelectArgs,
): ExternalWorktree[] {
	const mainRepo = canonicalPath(mainRepoPath);
	const requestedPaths = requested
		? new Set(Array.from(requested, canonicalPath))
		: null;

	return worktrees.filter((wt) => {
		const path = canonicalPath(wt.path);
		if (requestedPaths && !requestedPaths.has(path)) return false;
		if (path === mainRepo) return false;
		if (wt.isBare) return false;
		if (wt.isDetached) return false;
		if (!wt.branch) return false;
		return true;
	});
}
