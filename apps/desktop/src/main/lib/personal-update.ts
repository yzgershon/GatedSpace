/**
 * One-click updates for PERSONAL builds, from a folder on this machine.
 *
 * Public builds update through electron-updater against the GitHub release
 * feed (`auto-updater.ts`). A personal build has no feed and does not need
 * one: it is compiled on the same machine it runs on, so the installer is
 * already sitting in `apps/desktop/release/` before anything could download
 * it. Standing up a server would upload a ~300 MB file and fetch it straight
 * back to the disk it came from.
 *
 * So this module does the two things a feed would have done — notice that a
 * newer installer exists, and run it — and nothing else.
 *
 * DELIBERATELY INERT UNLESS CONFIGURED. There is no default path. The release
 * directory comes from `~/.superset/personal-update.json`; with no such file
 * this reports "no update" forever and the button never appears. That keeps a
 * developer's local layout out of a build that also ships publicly.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";

export interface PersonalUpdateInfo {
	version: string;
	installerPath: string;
}

const CONFIG_FILE = "personal-update.json";

/**
 * `GatedSpace-personal-1.17.48-arm64.exe`. The `-personal` segment is what
 * `electron-builder.ts` adds when `GATEDSPACE_PERSONAL=1`, so matching on it
 * means a public artifact sitting in the same folder is never offered.
 */
const INSTALLER_PATTERN = /^GatedSpace-personal-(\d+\.\d+\.\d+)-[\w-]+\.exe$/i;

function readReleaseDir(): string | null {
	try {
		const raw = readFileSync(join(homedir(), ".superset", CONFIG_FILE), "utf8");
		const parsed: unknown = JSON.parse(raw);
		if (!parsed || typeof parsed !== "object") return null;
		const dir = (parsed as { releaseDir?: unknown }).releaseDir;
		if (typeof dir !== "string" || !dir.trim()) return null;
		// Absolute only. A relative path would resolve against whatever the
		// packaged app's cwd happens to be, which is not a useful answer.
		if (!isAbsolute(dir)) return null;
		return existsSync(dir) ? dir : null;
	} catch {
		// Unreadable or invalid JSON degrades to "feature off" rather than
		// throwing on every check. Note that `"C:\Dev\..."` is INVALID JSON —
		// `\D` is not an escape — so the file wants forward slashes.
		return null;
	}
}

/** Numeric semver-ish compare. Returns >0 when `a` is newer than `b`. */
export function compareVersions(a: string, b: string): number {
	const pa = a.split(".").map((n) => Number.parseInt(n, 10) || 0);
	const pb = b.split(".").map((n) => Number.parseInt(n, 10) || 0);
	for (let i = 0; i < 3; i++) {
		const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
		if (diff !== 0) return diff;
	}
	return 0;
}

/**
 * The NEWEST installer in the release folder that is strictly newer than
 * `currentVersion`, or null.
 *
 * Deliberately the newest rather than the next one up: sitting three builds
 * behind should be one click to current, not three. The folder routinely holds
 * several old installers and picking the nearest would walk them one at a time.
 */
export function findPersonalUpdate(
	currentVersion: string,
	releaseDir: string | null = readReleaseDir(),
): PersonalUpdateInfo | null {
	if (!releaseDir) return null;
	let best: PersonalUpdateInfo | null = null;
	let entries: string[];
	try {
		entries = readdirSync(releaseDir);
	} catch {
		return null;
	}
	for (const entry of entries) {
		const match = INSTALLER_PATTERN.exec(entry);
		if (!match) continue;
		const version = match[1];
		if (!version) continue;
		// Strictly newer, so a rebuild of the running version is not an "update"
		// and cannot invite a pointless reinstall.
		if (compareVersions(version, currentVersion) <= 0) continue;
		if (best && compareVersions(version, best.version) <= 0) continue;
		best = { version, installerPath: join(releaseDir, entry) };
	}
	return best;
}

/**
 * Quit, install, relaunch.
 *
 * MEASURED, not guessed. The first version spawned PowerShell with
 * `detached: true` and it silently did nothing — the app closed and no install
 * ever happened. On Windows `detached` creates the process with
 * DETACHED_PROCESS, which means NO CONSOLE, and powershell.exe is a console
 * application: it starts, finds nowhere to attach, and exits 0 without running
 * a single statement. Exit code 0 with no stderr is what made it invisible.
 *
 * Dropping `detached` is not the fix either — without it the child shares this
 * process's console and dies with it.
 *
 * What works, verified end to end: a short-lived NON-detached PowerShell (so it
 * has a console and actually runs) whose only job is `Start-Process`, which
 * creates a genuinely independent grandchild. That grandchild is a .cmd file,
 * so there is no nested quoting to get wrong and no execution-policy to satisfy.
 *
 * The waiter polls by IMAGE NAME rather than a pid. Electron is several
 * processes and every one of them has to be gone before NSIS can replace
 * `GatedSpace.exe` and `resourcespp.asar` — the half-install this whole
 * dance exists to avoid.
 */
export function installPersonalUpdate(
	installerPath: string,
	quit: () => void,
): void {
	if (!existsSync(installerPath)) {
		throw new Error(`Installer no longer exists: ${installerPath}`);
	}

	const logPath = join(tmpdir(), "gatedspace-personal-update.log");
	const waiterPath = join(tmpdir(), "gatedspace-install.cmd");

	/*
	 * Bounded at 120 ticks. A waiter that loops forever because something is
	 * wedged is worse than one that gives up: it would sit there holding a
	 * stale installer, and run it whenever the app happened to close next.
	 */
	const waiter = [
		"@echo off",
		`> "${logPath}" echo [%DATE% %TIME%] waiting for GatedSpace to exit`,
		"set /a n=0",
		":wait",
		"set /a n+=1",
		"if %n% GTR 120 goto giveup",
		'tasklist /FI "IMAGENAME eq GatedSpace.exe" /NH 2>nul | find /I "GatedSpace.exe" >nul || goto run',
		"timeout /t 1 /nobreak >nul",
		"goto wait",
		":giveup",
		`>> "${logPath}" echo [%DATE% %TIME%] gave up after %n% ticks, app still running`,
		"goto end",
		":run",
		`>> "${logPath}" echo [%DATE% %TIME%] running installer after %n% ticks`,
		`"${installerPath}" /S --force-run`,
		`>> "${logPath}" echo [%DATE% %TIME%] installer exited with %ERRORLEVEL%`,
		":end",
		"",
	].join("\r\n");

	writeFileSync(waiterPath, waiter, "utf8");

	// `-Command` only, and NOT detached: this one has to actually run.
	const launcher = `Start-Process -FilePath 'cmd.exe' -ArgumentList '/c','"${waiterPath}"' -WindowStyle Hidden`;
	const result = spawnSync(
		"powershell.exe",
		["-NoProfile", "-Command", launcher],
		{ windowsHide: true, timeout: 15_000 },
	);
	if (result.error || result.status !== 0) {
		throw new Error(
			`Could not start the installer: ${result.error?.message ?? `exit ${result.status}`}`,
		);
	}

	quit();
}
