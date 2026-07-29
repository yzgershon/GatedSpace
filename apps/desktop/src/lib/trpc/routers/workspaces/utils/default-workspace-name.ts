import { workspaces } from "@superset/local-db";
import { eq } from "drizzle-orm";

import { localDb } from "main/lib/local-db";

/**
 * Workspaces used to be named after their branch, which made the sidebar a wall
 * of near-identical branch names and said nothing about what you were doing in
 * each one. They are now numbered instead — "Workspace 1", "Workspace 2" — and
 * renamed by hand when the name starts to matter.
 *
 * The number is decided ONCE, at creation, and stored in the name. Nothing
 * renumbers afterwards: a workspace keeps its number for as long as it exists,
 * and deleting one leaves a gap rather than shuffling everything below it up.
 * A number you have learned to reach for should never come to mean a different
 * workspace.
 */
const DEFAULT_WORKSPACE_NAME_PATTERN = /^Workspace (\d+)$/;

export function isDefaultWorkspaceName(name: string): boolean {
	return DEFAULT_WORKSPACE_NAME_PATTERN.test(name.trim());
}

export function parseDefaultWorkspaceNumber(name: string): number | null {
	const match = name.trim().match(DEFAULT_WORKSPACE_NAME_PATTERN);
	if (!match?.[1]) return null;
	const parsed = Number.parseInt(match[1], 10);
	return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

/**
 * The next name to hand out, given every name already in use.
 *
 * Highest-in-use plus one, NOT a count of rows. Counting would hand out a
 * number that is already taken as soon as anything in the middle is deleted:
 * three workspaces numbered 1, 2, 3 minus number 2 leaves a count of 2, and the
 * next workspace would collide with the existing "Workspace 3".
 *
 * Names that are not of this shape — anything renamed by hand — are ignored
 * rather than treated as zero, so renaming a workspace cannot drag the counter
 * backwards onto a number still in use.
 */
export function nextDefaultWorkspaceName(existingNames: readonly string[]) {
	let highest = 0;
	for (const name of existingNames) {
		const parsed = parseDefaultWorkspaceNumber(name);
		if (parsed !== null && parsed > highest) highest = parsed;
	}
	return `Workspace ${highest + 1}`;
}

/**
 * Numbering runs per project, so every project starts at 1. Sharing one counter
 * across projects would open a brand new project at "Workspace 12".
 *
 * Workspaces mid-deletion are included deliberately: deletion is asynchronous
 * (the worktree still has to come off disk) and a workspace created in that
 * window must not take the number of one still visibly winding down.
 */
export function allocateDefaultWorkspaceName(projectId: string): string {
	const rows = localDb
		.select({ name: workspaces.name })
		.from(workspaces)
		.where(eq(workspaces.projectId, projectId))
		.all();
	return nextDefaultWorkspaceName(rows.map((row) => row.name));
}
