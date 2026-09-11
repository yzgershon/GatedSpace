/**
 * "Is this shell actually doing something, or just sitting at a prompt?"
 *
 * The background-shells button used to count every session that was alive and
 * not attached to an open pane. That counts an idle PowerShell exactly the same
 * as one three minutes into a build, which is why it would report four shells
 * when nothing was happening.
 *
 * A shell running a command has a child process. A shell at a prompt does not.
 * That is the whole discriminator, and it needs a process table with parent
 * pids — which is the part that has to be written twice, because `ps` does not
 * exist on Windows. The pty-daemon's own `process-tree.ts` is `ps`-only and
 * therefore silently returns nothing on this platform; do not reuse it here.
 *
 * FAILURE IS NOT "NOT BUSY". If the table cannot be read, `hasLiveChildren`
 * returns null and callers fall back to counting the session. Reporting zero
 * background shells because a subprocess failed would hide exactly the thing
 * the button exists to show.
 */
import { spawnSync } from "node:child_process";

export interface ProcessRow {
	pid: number;
	ppid: number;
}

/** How long a table is reused. The button polls every 10s; this makes the
 *  common case one read per poll rather than one per session. */
const CACHE_TTL_MS = 5_000;

let cached: { rows: ProcessRow[]; readAt: number } | null = null;

function parsePosix(stdout: string): ProcessRow[] {
	const rows: ProcessRow[] = [];
	for (const line of stdout.split("\n")) {
		const [pidText, ppidText] = line.trim().split(/\s+/);
		const pid = Number(pidText);
		const ppid = Number(ppidText);
		if (Number.isInteger(pid) && pid > 0 && Number.isInteger(ppid)) {
			rows.push({ pid, ppid });
		}
	}
	return rows;
}

/**
 * CSV out of CIM. `wmic` would be terser but is deprecated and absent on newer
 * Windows images; `tasklist` does not report a parent pid at all.
 */
function parseWindows(stdout: string): ProcessRow[] {
	const rows: ProcessRow[] = [];
	for (const line of stdout.split("\n")) {
		const cleaned = line.trim().replace(/"/g, "");
		if (!cleaned || cleaned.startsWith("ProcessId")) continue;
		const [pidText, ppidText] = cleaned.split(",");
		const pid = Number(pidText);
		const ppid = Number(ppidText);
		if (Number.isInteger(pid) && pid > 0 && Number.isInteger(ppid)) {
			rows.push({ pid, ppid });
		}
	}
	return rows;
}

/** Every running process as {pid, ppid}, or an empty array if unavailable. */
export function readProcessTable(now = Date.now()): ProcessRow[] {
	if (cached && now - cached.readAt < CACHE_TTL_MS) return cached.rows;

	const result =
		process.platform === "win32"
			? spawnSync(
					"powershell.exe",
					[
						"-NoProfile",
						"-NonInteractive",
						"-Command",
						"Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId | ConvertTo-Csv -NoTypeInformation",
					],
					{ encoding: "utf8", windowsHide: true, timeout: 5_000 },
				)
			: spawnSync("ps", ["-axo", "pid=,ppid="], {
					encoding: "utf8",
					timeout: 5_000,
				});

	if (result.error || result.status !== 0 || !result.stdout) {
		// Cache the failure briefly too, so a broken environment does not spawn
		// a doomed subprocess on every single call.
		cached = { rows: [], readAt: now };
		return [];
	}

	const rows =
		process.platform === "win32"
			? parseWindows(result.stdout)
			: parsePosix(result.stdout);
	cached = { rows, readAt: now };
	return rows;
}

/**
 * Whether `pid` has at least one live descendant.
 *
 * Returns null when the table is unavailable, which callers must treat as
 * "assume it is busy" rather than "it is idle" — see the note at the top.
 */
export function hasLiveChildren(
	pid: number,
	rows: ProcessRow[] = readProcessTable(),
): boolean | null {
	if (rows.length === 0) return null;
	// One level is enough: a shell running anything at all has an immediate
	// child, and walking the whole tree would cost more for the same answer.
	return rows.some((row) => row.ppid === pid);
}

/** Test seam — the module-level cache otherwise leaks between cases. */
export function resetProcessTableCache(): void {
	cached = null;
}
