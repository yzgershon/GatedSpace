/**
 * Lets a development instance run BESIDE the installed app, and refuses to run
 * at all if it cannot do so safely.
 *
 * Why this exists: `bun run dev` has never worked. `electron-vite dev` starts an
 * Electron instance with the same identity as the installed app, so
 * `requestSingleInstanceLock()` in `main/index.ts` hands it nothing and it calls
 * `app.exit(0)` — SILENTLY. No error, no window, no log. The dev SERVER half was
 * always fine; `window-loader.ts` has loaded from Vite under `NODE_ENV=development`
 * the whole time. Only the launch half was broken.
 *
 * Electron's single-instance lock lives INSIDE the user data directory, so a
 * different `userData` is a different lock. That is the entire fix.
 *
 * **`userData` is derived from `SUPERSET_HOME_DIR` rather than configured
 * separately, and that is the load-bearing decision.** Half-isolation is worse
 * than none:
 *
 *  - Separate `userData`, shared `SUPERSET_HOME_DIR` → two apps share
 *    `local.db`, `projects`, `worktrees` and `session-locks`. The session lock
 *    is what stops one session id being resumed by two live panes, and that
 *    exact collision destroyed transcripts on 7/18 AND 7/19. Two apps sharing
 *    one home is that bug with a second process attached.
 *  - Separate `SUPERSET_HOME_DIR`, shared `userData` → the dev instance dies on
 *    the lock, which is today's silent failure.
 *
 * Tying them to one variable makes the broken halves unreachable. There is no
 * combination of environment variables that produces a partly-isolated instance.
 *
 * Everything else isolates for free once the home directory moves, because all
 * app state already lives under it: `local.db`, `tanstack-db.sqlite`,
 * `app-state.json`, `window-state.json`, `session-locks/`, `search-roots.json`,
 * `port-allocations.json`, and the host-service manifest under `host/<org>/`.
 * The host service picks its port with `findFreePort` and publishes it in that
 * manifest, so a separate home means a separate service on a separate port.
 * `ptyDaemonSocketPath` already keys its named pipe on
 * `${organizationId}:${home}` when `NODE_ENV === "development"` and the home is
 * non-default, so the pty daemon separates on exactly the same condition this
 * function enforces.
 */
import { homedir } from "node:os";
import path from "node:path";
import { app, dialog } from "electron";
import { SUPERSET_HOME_DIR } from "./app-environment";

/**
 * The installed app's home, spelled out rather than derived.
 *
 * `SUPERSET_DIR_NAME` is NOT the right thing to compare against: it already
 * bends to `SUPERSET_WORKSPACE_NAME`, so under that variable it resolves to
 * `.superset-dev` and a check against it would call the dev home "the default"
 * and refuse every launch. What must never be shared is specifically the home
 * the INSTALLED app uses, and that one is always `.superset`.
 *
 * `ptyDaemonSocketPath` compares against this same literal for the same reason;
 * the two have to agree or the daemon would separate on a different condition
 * than the rest of the instance.
 */
const INSTALLED_APP_DIR_NAME = ".superset";

/** Electron state (the single-instance lock, localStorage, caches) for this home. */
export function userDataDirForHome(supersetHomeDir: string): string {
	return path.join(supersetHomeDir, "electron-user-data");
}

/** Whether this home is the one the installed app reads and writes. */
export function isInstalledAppHome(supersetHomeDir: string): boolean {
	const installedHome = path.join(homedir(), INSTALLED_APP_DIR_NAME);
	return path.resolve(supersetHomeDir) === path.resolve(installedHome);
}

/**
 * Call this BEFORE `app.requestSingleInstanceLock()`, and before anything reads
 * `app.getPath("userData")`. Both `cost-store` and `network-logger` read it, but
 * only from inside functions, so importing them first is fine.
 *
 * A no-op in a packaged build: the installed app must keep the real home and the
 * real lock, or a second launch would open a second copy of itself.
 */
export function applyDevInstanceIsolation(): void {
	if (process.env.NODE_ENV !== "development") return;

	if (isInstalledAppHome(SUPERSET_HOME_DIR)) {
		/*
		 * Fail CLOSED, and say why.
		 *
		 * The alternative — carrying on against the real home — is the pair of
		 * transcript losses described above, arriving as "I ran the dev build and
		 * my session is empty". Refusing costs a restart; guessing costs work
		 * that has no other copy.
		 *
		 * `showErrorBox` is one of the few dialog calls allowed before `ready`,
		 * which matters: the whole failure mode being replaced here is a dev
		 * launch that exits without telling anyone.
		 */
		const message = [
			"A development instance must not share the installed app's data.",
			"",
			`This instance's home is the installed app's own (${SUPERSET_HOME_DIR}).`,
			"Two instances sharing one home share local.db, projects, worktrees and",
			"session-locks, which is how one session id ends up resumed by two live",
			"panes. That has destroyed transcripts before.",
			"",
			"Set SUPERSET_HOME_DIR to a directory that is not ~/.superset. The repo",
			"root .env already does (superset-dev-data), and electron.vite loads it",
			"with override:true, so a normal `bun run dev` picks it up. If you are",
			"seeing this, that line is missing or was edited.",
		].join("\n");
		console.error(`[dev-instance] refusing to start.\n${message}`);
		dialog.showErrorBox("GatedSpace Dev cannot start", message);
		app.exit(1);
		return;
	}

	const userData = userDataDirForHome(SUPERSET_HOME_DIR);
	app.setPath("userData", userData);
	/*
	 * `logs` has to move explicitly, because electron-log resolved its path at
	 * IMPORT time — before this runs — and kept the default userData. The dev
	 * instance was therefore appending to the INSTALLED app's
	 * `AppData/Roaming/GatedSpace/logs/main.log`, interleaving two apps in one
	 * file. That is not just untidy: reading that file to diagnose a packaged-app
	 * bug hands you dev's lines (they carry `localhost:3005` URLs) and it takes a
	 * while to notice you are debugging the wrong process.
	 */
	app.setPath("logs", path.join(userData, "logs"));
	console.log(
		`[dev-instance] isolated: home=${SUPERSET_HOME_DIR} userData=${userData}`,
	);
}
