import { join } from "node:path";
import { projects, workspaces, worktrees } from "@superset/local-db";
import Database from "better-sqlite3";
import { eq, isNull } from "drizzle-orm";
import {
	listKnownOrganizationIds,
	manifestDir,
} from "../host-service-manifest";

import { localDb } from "../local-db";

/**
 * A place the phone can start a session in.
 *
 * Starting a session needs a working directory, and on the phone that has to be
 * CHOSEN rather than typed — a path field on a phone keyboard, pointed at a
 * machine you cannot see, is both miserable and a way to run an agent somewhere
 * you did not mean to. The phone only ever gets to pick from this list, so the
 * set of directories reachable from off the desk is exactly the set already set
 * up on the desktop.
 */
export interface BridgeWorkspaceTarget {
	id: string;
	name: string;
	/** The project it belongs to, so two "Workspace 1"s stay distinguishable. */
	project: string;
	cwd: string;
}

export function listBridgeWorkspaceTargets(): BridgeWorkspaceTarget[] {
	// Current workspaces live in the per-organization host database. Read-only:
	// this bridge must not run migrations or take ownership of the host's DB.
	const current: BridgeWorkspaceTarget[] = [];
	for (const organization of listKnownOrganizationIds()) {
		let db: Database.Database | undefined;
		try {
			db = new Database(join(manifestDir(organization), "host.db"), {
				readonly: true,
				fileMustExist: true,
				timeout: 250,
			});
			current.push(
				...(db
					.prepare(`SELECT w.id, COALESCE(NULLIF(w.name, ''), w.branch, 'Workspace') AS name,
				COALESCE(p.name, p.repo_name, p.repo_path) AS project, w.worktree_path AS cwd
				FROM workspaces w JOIN projects p ON p.id = w.project_id`)
					.all() as BridgeWorkspaceTarget[]),
			);
		} catch {
			/* A host still starting/migrating will be listed on the next request. */
		} finally {
			db?.close();
		}
	}
	const rows = localDb
		.select({
			id: workspaces.id,
			name: workspaces.name,
			type: workspaces.type,
			projectName: projects.name,
			mainRepoPath: projects.mainRepoPath,
			worktreePath: worktrees.path,
		})
		.from(workspaces)
		.innerJoin(projects, eq(workspaces.projectId, projects.id))
		.leftJoin(worktrees, eq(workspaces.worktreeId, worktrees.id))
		.where(isNull(workspaces.deletingAt))
		.all();

	const legacy = rows.flatMap((row) => {
		// A worktree workspace whose worktree row is missing has no directory to
		// run in. Offering it would produce a session that dies on spawn with an
		// error the phone has no good way to explain.
		const cwd = row.type === "branch" ? row.mainRepoPath : row.worktreePath;
		if (!cwd) return [];
		return [
			{
				id: row.id,
				// Main workspaces display as "local" everywhere else in the app.
				name: row.type === "branch" ? "local" : row.name,
				project: row.projectName,
				cwd,
			},
		];
	});
	const seen = new Set(current.map((target) => target.id));
	return [...current, ...legacy.filter((target) => !seen.has(target.id))];
}
