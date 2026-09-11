#!/usr/bin/env bun
/**
 * Fills the development instance's home with a copy of the installed app's, so
 * `bun run dev` opens looking like the real thing instead of a first-run wizard.
 *
 * The point of the dev instance is iterating on the UI. A UI with no workspaces,
 * no projects and no presets does not exercise the sidebar, the group switcher
 * or the pane chrome, which is most of what there is to look at — so an empty
 * dev home is a dev instance you cannot use for the thing it is for.
 *
 * WHAT IS DELIBERATELY NOT COPIED, and why each one would be a bug:
 *
 *  - `host/<org>/manifest.json` carries the LIVE host service's endpoint and its
 *    pre-shared key. Copy it and the dev instance talks to the INSTALLED app's
 *    host service: one service, one pty daemon, one set of terminals, which is
 *    precisely the collision the separate home exists to prevent. The dev
 *    instance writes its own manifest on first launch, on its own free port.
 *
 * `host/<org>/host.db` IS copied, and it is the whole reason the dev instance
 * can show anything. The workspace list does not come from `local.db` or from
 * the tanstack-db collections — `useHostWorkspaces()` asks the HOST SERVICE,
 * and the host service reads this file. Excluding the entire `host/` directory
 * (rather than just the manifest) left dev with an empty host database, so
 * every project showed 0 workspaces, the dashboard sat on skeletons forever,
 * and `/v2-workspace/<id>` could not resolve its workspace and rendered
 * nothing. The manifest is still excluded; only the data comes across.
 *  - `session-locks/` is the two-writer guard. Copying locks would hand the dev
 *    instance stale claims on sessions it does not own.
 *  - `*.token`, `terminal-host.*` are credentials and pids for processes that
 *    belong to the other instance.
 *  - `port-allocations.json` would make both instances believe they own the
 *    same ports.
 *  - `worktrees/` is not copied and that is a CHOICE, not an omission. The
 *    workspaces in `local.db` hold absolute paths into `~/.superset/worktrees`,
 *    so the dev instance opens the REAL repositories. That is what makes it a
 *    replica rather than a demo — real file trees, real diffs, real content in
 *    the panes. It also means the dev instance can write to real code, so treat
 *    it as a second editor open on the same folders, not as a sandbox.
 *  - `terminal-scrollback/`, `daemon.log`, `backups/` are large and are history
 *    belonging to the other instance.
 *
 * Re-runnable. Pass `--force` to overwrite files that already exist in the dev
 * home, which is what you want after the real app has moved on.
 */
import {
	cpSync,
	existsSync,
	mkdirSync,
	readdirSync,
	rmSync,
	statSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { config } from "dotenv";

// Same load the vite config does, and for the same reason: `.env` is where this
// repo pins SUPERSET_HOME_DIR, and `override: true` is why it beats whatever is
// already in the environment.
config({
	path: path.resolve(import.meta.dirname, "../../../.env"),
	override: true,
	quiet: true,
});

const INSTALLED_HOME = path.join(homedir(), ".superset");
const DEV_HOME = process.env.SUPERSET_HOME_DIR;

/** Copied because the UI reads them and they are safe to duplicate. */
const SEED_ENTRIES = [
	"local.db",
	"local.db-shm",
	"local.db-wal",
	"tanstack-db.sqlite",
	"tanstack-db.sqlite-shm",
	"tanstack-db.sqlite-wal",
	"app-state.json",
	"window-state.json",
	"search-roots.json",
	"session-titles.json",
	"claude-profile.json",
	/*
	 * The signed-in session. Without it the dev instance runs cloud mode with no
	 * user, so every tanstack-db collection scopes to nobody and returns empty —
	 * which is why the sidebar showed 0 workspaces under every project and the
	 * content area sat on skeletons, even though the local cache holds all 11
	 * rows. Same user, same account, so sharing the token is not a second
	 * identity.
	 */
	"auth-token.enc",
	"project-icons",
	"projects",
];

/**
 * Removed from the dev home if present. These are the entries that would make
 * the dev instance reach into the installed app's running processes, and a
 * stale one is worse than none — a dead manifest at least gets replaced.
 */
const STALE_ENTRIES = [
	"session-locks",
	"terminal-host.pid",
	"terminal-host.token",
	"terminal-host.mtime",
	"port-allocations.json",
];

function fail(message: string): never {
	console.error(`[seed-dev-home] ${message}`);
	process.exit(1);
}

if (!DEV_HOME) {
	fail(
		"SUPERSET_HOME_DIR is not set. The repo root .env should define it " +
			"(superset-dev-data). Without it the dev instance would share the " +
			"installed app's home, which main/lib/dev-instance-isolation.ts refuses.",
	);
}

if (path.resolve(DEV_HOME) === path.resolve(INSTALLED_HOME)) {
	fail(
		`SUPERSET_HOME_DIR resolves to the installed app's own home (${DEV_HOME}). ` +
			"Refusing: seeding it onto itself is meaningless, and running against " +
			"it is the two-instances-one-home case that has cost transcripts.",
	);
}

if (!existsSync(INSTALLED_HOME)) {
	fail(`No installed-app home to seed from at ${INSTALLED_HOME}.`);
}

const force = process.argv.includes("--force");
mkdirSync(DEV_HOME, { recursive: true });

let copied = 0;
let skipped = 0;

for (const entry of SEED_ENTRIES) {
	const source = path.join(INSTALLED_HOME, entry);
	if (!existsSync(source)) continue;

	const target = path.join(DEV_HOME, entry);
	if (existsSync(target) && !force) {
		skipped++;
		continue;
	}

	// `recursive` covers both cases; statting first is only for the log line.
	const isDir = statSync(source).isDirectory();
	cpSync(source, target, { recursive: true });
	copied++;
	console.log(`  copied  ${entry}${isDir ? "/" : ""}`);
}

/*
 * The host service's database, per org, WITHOUT its manifest.
 *
 * Copied file-by-file rather than by copying `host/`, because the manifest
 * sitting next to it is the one file that must never come across.
 */
let hostDbs = 0;
const installedHostDir = path.join(INSTALLED_HOME, "host");
if (existsSync(installedHostDir)) {
	for (const org of readdirSync(installedHostDir)) {
		const sourceOrgDir = path.join(installedHostDir, org);
		if (!statSync(sourceOrgDir).isDirectory()) continue;

		const targetOrgDir = path.join(DEV_HOME, "host", org);
		mkdirSync(targetOrgDir, { recursive: true });

		// The whole WAL set. Copying host.db alone yields a stale snapshot,
		// and the running app keeps a lot of recent state in the -wal.
		for (const file of ["host.db", "host.db-wal", "host.db-shm"]) {
			const source = path.join(sourceOrgDir, file);
			if (!existsSync(source)) continue;
			const target = path.join(targetOrgDir, file);
			if (existsSync(target) && !force) continue;
			cpSync(source, target);
			hostDbs++;
			console.log(`  copied  host/${org}/${file}`);
		}

		// Dev must publish its own endpoint and PSK, on its own free port.
		const manifest = path.join(targetOrgDir, "manifest.json");
		if (existsSync(manifest)) {
			rmSync(manifest, { force: true });
			console.log(`  cleared host/${org}/manifest.json`);
		}
	}
}

let cleared = 0;
for (const entry of STALE_ENTRIES) {
	const target = path.join(DEV_HOME, entry);
	if (!existsSync(target)) continue;
	rmSync(target, { recursive: true, force: true });
	cleared++;
	console.log(`  cleared ${entry}`);
}

console.log("");
console.log(`[seed-dev-home] from ${INSTALLED_HOME}`);
console.log(`[seed-dev-home] into ${DEV_HOME}`);
console.log(
	`[seed-dev-home] ${copied} copied, ${hostDbs} host db file(s), ${skipped} left alone${
		force ? "" : " (--force to overwrite)"
	}, ${cleared} stale entries cleared.`,
);
console.log(
	"[seed-dev-home] Workspaces point at the REAL worktrees under " +
		"~/.superset/worktrees. Treat the dev instance as a second editor on those " +
		"folders, not a sandbox.",
);
