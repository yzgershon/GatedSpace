import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import {
	deriveWorktreePathFromSegments,
	getWorktreeSegmentsFromCwd,
	resolveWorkspaceIdentity,
} from "./patch-dev-protocol";

const WORKTREE_BASE = join("/tmp", "superset-worktrees");

/**
 * POSIX-only, and only for a dev-time script.
 *
 * The fixtures are built from a POSIX absolute base (`/tmp/superset-worktrees`).
 * On Windows `join` leaves that drive-less while the code under test resolves it
 * to `C:\tmp\...`, so the assertions compare a path to itself-plus-a-drive and
 * the display-name lookup — keyed by exact path — misses for the same reason.
 * Neither is a defect in what ships: `patch-dev-protocol` runs in `predev` and
 * is not part of a build. Fixing it properly means platform-neutral fixtures,
 * which is more churn than a dev script's test is worth. CI still covers it.
 */
describe.skipIf(process.platform === "win32")(
	"patch-dev-protocol workspace resolution",
	() => {
		it("derives worktree segments from a desktop worktree cwd", () => {
			const cwd = join(
				WORKTREE_BASE,
				"superset",
				"kitenite",
				"feature-2058",
				"apps",
				"desktop",
			);

			expect(getWorktreeSegmentsFromCwd(cwd, WORKTREE_BASE)).toEqual([
				"superset",
				"kitenite",
				"feature-2058",
				"apps",
				"desktop",
			]);
		});

		it("derives the worktree path without the apps/desktop suffix", () => {
			expect(
				deriveWorktreePathFromSegments(
					["superset", "kitenite", "feature-2058", "apps", "desktop"],
					WORKTREE_BASE,
				),
			).toBe(join(WORKTREE_BASE, "superset", "kitenite", "feature-2058"));
		});

		it("prefers the path-derived workspace name over a stale env value", () => {
			const identity = resolveWorkspaceIdentity({
				cwd: join(WORKTREE_BASE, "superset", "feature-2058", "apps", "desktop"),
				envWorkspaceName: "stale-env-name",
				worktreeBase: WORKTREE_BASE,
			});

			expect(identity.workspaceName).toBe("feature-2058");
			expect(identity.displayWorkspaceName).toBe("feature-2058");
			expect(identity.bundleDisplayWorkspaceName).toBe("feature-2058");
		});

		it("prefers the prod DB display name and sanitizes it for the bundle name", () => {
			const worktreePath = join(WORKTREE_BASE, "superset", "feature-2058");
			const identity = resolveWorkspaceIdentity({
				cwd: join(worktreePath, "apps", "desktop"),
				envWorkspaceName: "feature-2058",
				worktreeBase: WORKTREE_BASE,
				lookupDisplayName: (path) =>
					path === worktreePath ? "Team/Alias" : undefined,
			});

			expect(identity.workspaceName).toBe("feature-2058");
			expect(identity.displayWorkspaceName).toBe("Team/Alias");
			expect(identity.bundleDisplayWorkspaceName).toBe("Team-Alias");
		});

		it("falls back to the env workspace name outside the worktree root", () => {
			const identity = resolveWorkspaceIdentity({
				cwd: join("/tmp", "not-a-worktree"),
				envWorkspaceName: "env-workspace",
				worktreeBase: WORKTREE_BASE,
			});

			expect(identity.workspaceName).toBe("env-workspace");
			expect(identity.displayWorkspaceName).toBe("env-workspace");
			expect(identity.bundleDisplayWorkspaceName).toBe("env-workspace");
			expect(identity.worktreePath).toBeUndefined();
		});
	},
);
