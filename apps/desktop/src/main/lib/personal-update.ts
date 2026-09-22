/** Personal builds install a completed local artifact, never a public release. */
import { execFile } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { promisify } from "node:util";

export interface PersonalUpdateInfo {
	version: string;
	installerPath: string;
}
const INSTALLER_PATTERN =
	/^GatedSpace-personal-(\d+\.\d+\.\d+)-(arm64|x64|ia32)\.exe$/i;

export function readPersonalReleaseDir(): string | null {
	const config = join(homedir(), ".superset", "personal-update.json");
	if (!existsSync(config)) return null;
	try {
		const parsed = JSON.parse(readFileSync(config, "utf8"));
		const dir = parsed?.releaseDir;
		if (typeof dir !== "string" || !isAbsolute(dir))
			throw new Error("releaseDir must be an absolute folder path");
		if (!statSync(dir).isDirectory())
			throw new Error("releaseDir is not a folder");
		return dir;
	} catch (error) {
		throw new Error(
			`Cannot read personal updates from ${config}: ${error instanceof Error ? error.message : error}`,
		);
	}
}
export function compareVersions(a: string, b: string): number {
	const pa = a.split(".").map(Number);
	const pb = b.split(".").map(Number);
	for (let i = 0; i < 3; i++) {
		const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
		if (diff !== 0) return diff;
	}
	return 0;
}
export function findPersonalUpdate(
	currentVersion: string,
	releaseDir: string | null = readPersonalReleaseDir(),
	arch: string = process.arch,
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
		if (!match || match[2]?.toLowerCase() !== arch) continue;
		const version = match[1];
		if (
			!version ||
			compareVersions(version, currentVersion) <= 0 ||
			(best && compareVersions(version, best.version) <= 0)
		)
			continue;
		const installerPath = join(releaseDir, entry);
		try {
			// Builder writes the blockmap after closing the finished installer.
			// Do not offer a half-written executable while a build is running.
			const exe = statSync(installerPath);
			const blockmap = statSync(`${installerPath}.blockmap`);
			if (
				!exe.isFile() ||
				!exe.size ||
				!blockmap.isFile() ||
				!blockmap.size ||
				blockmap.mtimeMs < exe.mtimeMs
			)
				continue;
		} catch {
			continue;
		}
		best = { version, installerPath };
	}
	return best;
}
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
export const encodePowerShell = (script: string) =>
	Buffer.from(script, "utf16le").toString("base64");

/** Exported for a Windows handoff test using a harmless fake installer. */
export function personalUpdateWorker(options: {
	installerPath: string;
	parentPid: number;
	readyPath: string;
	logPath: string;
	timeoutSeconds?: number;
}): string {
	return `
$ErrorActionPreference = 'Stop'
$log = ${quote(options.logPath)}
try {
  $parentProcess = Get-Process -Id ${options.parentPid} -ErrorAction SilentlyContinue
  Set-Content -LiteralPath ${quote(options.readyPath)} -Value 'ready'
  Add-Content -LiteralPath $log -Value 'Updater ready; waiting for the application to exit.'
  if ($parentProcess -and -not $parentProcess.WaitForExit(${(options.timeoutSeconds ?? 120) * 1000})) {
    throw 'GatedSpace did not close. The update was cancelled; retry after saving your work.'
  }
  Start-Sleep -Milliseconds 1000
  Add-Content -LiteralPath $log -Value 'Starting personal installer.'
  $installer = Start-Process -FilePath ${quote(options.installerPath)} -ArgumentList '/S','--force-run' -WindowStyle Hidden -PassThru -Wait
  if ($installer.ExitCode -ne 0) { throw "Installer exited with code $($installer.ExitCode)." }
  Add-Content -LiteralPath $log -Value 'Installation completed successfully.'
} catch {
  Add-Content -LiteralPath $log -Value "Update failed: $($_.Exception.Message)"
  exit 1
}
`;
}
/** Start a verified independent waiter before permitting the app to quit. */
export async function installPersonalUpdate(
	installerPath: string,
	quit: () => void,
	options: { logPath?: string } = {},
): Promise<void> {
	if (!existsSync(installerPath))
		throw new Error(`Installer no longer exists: ${installerPath}`);
	const attempt = await mkdtemp(join(tmpdir(), "gatedspace-update-"));
	const readyPath = join(attempt, "ready");
	const logPath =
		options.logPath ?? join(tmpdir(), "gatedspace-personal-update.log");
	const encoded = encodePowerShell(
		personalUpdateWorker({
			installerPath,
			parentPid: process.pid,
			readyPath,
			logPath,
		}),
	);
	const powershell = join(
		process.env.SystemRoot ?? "C:\\Windows",
		"System32",
		"WindowsPowerShell",
		"v1.0",
		"powershell.exe",
	);
	// EncodedCommand keeps apostrophes, spaces and shell metacharacters as data.
	// Start-Process avoids the detached console-process startup failure.
	const launch = `$ErrorActionPreference='Stop'; Start-Process -FilePath ${quote(powershell)} -ArgumentList '-NoProfile','-NonInteractive','-EncodedCommand',${quote(encoded)} -WindowStyle Hidden`;
	await promisify(execFile)(
		powershell,
		[
			"-NoProfile",
			"-NonInteractive",
			"-EncodedCommand",
			encodePowerShell(launch),
		],
		{ windowsHide: true, timeout: 15_000 },
	);
	const deadline = Date.now() + 10_000;
	while (Date.now() < deadline) {
		try {
			if ((await readFile(readyPath, "utf8")).trim() === "ready") {
				quit();
				return;
			}
		} catch {
			/* Await child startup acknowledgement. */
		}
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	throw new Error(
		`The updater did not start. GatedSpace was left open. Details: ${logPath}`,
	);
}
