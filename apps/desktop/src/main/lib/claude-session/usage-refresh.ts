/**
 * Ask a Claude profile for its real usage numbers, and persist them.
 *
 * Why this exists: the usage panel reads `<configDir>/cache/rate-limits.json`,
 * which is written by the CLI's STATUS LINE. A status line only renders in a
 * terminal, and the session pane is headless — so an account used only through
 * the pane never writes that file and reads 0% forever. That was the whole bug.
 *
 * `/usage` is answered locally by a one-shot process (`turns=0 cost=0`, probed
 * against the real binary), so this asks for it directly. It is NOT polling: no
 * request leaves the machine, which is the distinction the never-poll rule cares
 * about. It's still rate-limited below, because spawning a process per keystroke
 * would be silly for a number that moves slowly.
 */
import { spawn } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { listClaudeProfiles } from "main/lib/claude-profile";
import {
	parseUsageReport,
	toQuotaSnapshot,
	type UsageReport,
} from "shared/claude-session/usage-report";
import { resolveUsageWindow } from "shared/usage-window";
import { resolveExecutable } from "./resolve-executable";

/** A one-shot local command; if it hasn't answered by now it never will. */
const TIMEOUT_MS = 30_000;
/** Don't re-ask for a given profile more often than this. */
const MIN_INTERVAL_MS = 60_000;

const lastRun = new Map<string, number>();

/**
 * Delete the transcript the probe just wrote.
 *
 * Every one-shot leaves `<configDir>/projects/<encoded-cwd>/<sessionId>.jsonl`
 * behind, holding nothing but the `/usage` bookkeeping. At one refresh per
 * account every ten minutes that's several hundred files a day accumulating in
 * the user's Claude data forever — a mess this feature would be creating, so
 * this feature cleans it up.
 *
 * Scoped as tightly as it can be: only a file named for the session id THIS
 * process just reported, found by scanning rather than by re-deriving the cwd
 * encoding (which would silently target the wrong path the day it changes).
 */
function removeProbeTranscript(configDir: string, sessionId: string): void {
	// A stray id would make this a delete-by-pattern over the user's transcripts.
	if (!/^[0-9a-f-]{36}$/i.test(sessionId)) return;
	const projects = join(configDir, "projects");
	try {
		for (const entry of readdirSync(projects)) {
			const candidate = join(projects, entry, `${sessionId}.jsonl`);
			if (!existsSync(candidate)) continue;
			rmSync(candidate, { force: true });
			return;
		}
	} catch {
		// No projects dir, or no permission — the file staying is not worth an error.
	}
}

/** Run `/usage` against one profile and return its parsed reply. */
function runUsage(configDir: string): Promise<UsageReport | null> {
	return new Promise((resolve) => {
		let settled = false;
		const done = (value: UsageReport | null) => {
			if (settled) return;
			settled = true;
			resolve(value);
		};

		let child: ReturnType<typeof spawn>;
		try {
			const { command, needsShell } = resolveExecutable("claude");
			child = spawn(
				command,
				[
					"--print",
					"--input-format",
					"stream-json",
					"--output-format",
					"stream-json",
					"--verbose",
				],
				{
					stdio: ["pipe", "pipe", "ignore"],
					shell: needsShell,
					// `claude` on Windows is a .cmd shim, so `shell: true` routes this
					// through cmd.exe — and a GUI process spawning a console child gets
					// a console ALLOCATED for it, i.e. a visible window. This ticker
					// fires once at launch per account, so without this a launch
					// flashed a console box for every signed-in profile.
					windowsHide: true,
					env: { ...process.env, CLAUDE_CONFIG_DIR: configDir },
				},
			);
		} catch {
			// No claude on PATH is a normal state on a fresh machine, not an error
			// worth surfacing from a background refresh.
			done(null);
			return;
		}

		const timer = setTimeout(() => {
			child.kill("SIGTERM");
			done(null);
		}, TIMEOUT_MS);

		let out = "";
		child.stdout?.on("data", (chunk: Buffer) => {
			out += chunk.toString();
		});
		child.on("error", () => {
			clearTimeout(timer);
			done(null);
		});
		child.on("close", () => {
			clearTimeout(timer);
			// The reply arrives on the `result` event; take the last one, since a
			// stray assistant block could otherwise win.
			let text: string | null = null;
			let sessionId: string | null = null;
			for (const line of out.split("\n")) {
				if (!line.trim()) continue;
				try {
					const event = JSON.parse(line) as {
						type?: string;
						result?: unknown;
						session_id?: unknown;
					};
					if (typeof event.session_id === "string") {
						sessionId = event.session_id;
					}
					if (event.type === "result" && typeof event.result === "string") {
						text = event.result;
					}
				} catch {
					// Partial or non-JSON line; the next one may still be good.
				}
			}
			if (sessionId) removeProbeTranscript(configDir, sessionId);
			done(text ? parseUsageReport(text) : null);
		});

		child.stdin?.write(
			`${JSON.stringify({
				type: "user",
				message: { role: "user", content: [{ type: "text", text: "/usage" }] },
			})}\n`,
		);
		child.stdin?.end();
	});
}

/**
 * Write the snapshot where the usage panel already looks, MERGING rather than
 * replacing: the status line may have recorded reset timestamps that `/usage`
 * doesn't report, and clobbering them would trade a real countdown for none.
 */
function persist(configDir: string, report: UsageReport, now: number): void {
	const snapshot = toQuotaSnapshot(report, now);
	if (!snapshot) return;
	const path = join(configDir, "cache", "rate-limits.json");
	try {
		mkdirSync(dirname(path), { recursive: true });
		let existing: Record<string, unknown> = {};
		try {
			const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
			if (parsed && typeof parsed === "object") {
				existing = parsed as Record<string, unknown>;
			}
		} catch {
			// No prior file is the common case — that's the bug being fixed.
		}
		const merge = (key: "five_hour" | "seven_day", next: unknown) => {
			if (!next) return existing[key];
			const prior = existing[key];
			// Order matters: `next` wins, INCLUDING a null resets_at. Letting a
			// prior epoch survive is how a countdown ends up reading "resets now"
			// beside a percentage from a window that closed hours ago.
			return prior && typeof prior === "object"
				? { ...(prior as object), ...(next as object) }
				: next;
		};
		writeFileSync(
			path,
			JSON.stringify(
				{
					...existing,
					five_hour: merge("five_hour", snapshot.five_hour),
					seven_day: merge("seven_day", snapshot.seven_day),
					updatedAt: snapshot.updatedAt,
				},
				null,
				2,
			),
			"utf8",
		);
	} catch {
		// A read-only config dir shouldn't take down the refresh; the caller still
		// gets the parsed report to render.
	}
}

/**
 * Refresh one profile. Returns the report even when persisting failed, so a
 * caller rendering a dialog still has something to show.
 */
export async function refreshProfileUsage(
	configDir: string,
	options: { force?: boolean; now?: number } = {},
): Promise<UsageReport | null> {
	const now = options.now ?? Date.now();
	const previous = lastRun.get(configDir);
	if (!options.force && previous && now - previous < MIN_INTERVAL_MS) {
		return null;
	}
	lastRun.set(configDir, now);

	const report = await runUsage(configDir);
	if (report) persist(configDir, report, now);
	return report;
}

export interface ProfileLimits {
	fiveHourPercent: number | null;
	fiveHourResets: string | null;
	weeklyPercent: number | null;
	weeklyResets: string | null;
	updatedAt: number | null;
}

/**
 * Read a profile's stored limits WITHOUT spawning anything.
 *
 * The refresh above writes this file; this just reads it back, so a caller that
 * wants to render the numbers doesn't pay for a process. Returns nulls rather
 * than throwing when the file isn't there yet — that's the normal state for an
 * account that hasn't been used.
 */
export function readProfileLimits(configDir: string): ProfileLimits {
	const empty: ProfileLimits = {
		fiveHourPercent: null,
		fiveHourResets: null,
		weeklyPercent: null,
		weeklyResets: null,
		updatedAt: null,
	};
	try {
		const parsed: unknown = JSON.parse(
			readFileSync(join(configDir, "cache", "rate-limits.json"), "utf8"),
		);
		if (!parsed || typeof parsed !== "object") return empty;
		const record = parsed as Record<string, unknown>;
		// Resolved against NOW, not read verbatim: a window past its reset moment
		// has rolled over, and reporting the previous window's percentage is how
		// the strip came to show "53% used" an hour after it reset.
		const now = Date.now();
		const fiveHour = resolveUsageWindow(record.five_hour, now);
		const weekly = resolveUsageWindow(record.seven_day, now);
		return {
			fiveHourPercent: fiveHour?.usedPercent ?? null,
			fiveHourResets: fiveHour?.resetsLabel ?? null,
			weeklyPercent: weekly?.usedPercent ?? null,
			weeklyResets: weekly?.resetsLabel ?? null,
			updatedAt: typeof record.updatedAt === "number" ? record.updatedAt : null,
		};
	} catch {
		return empty;
	}
}

/**
 * Refresh every profile that has finished its CLI login. Unauthenticated ones
 * are skipped: `/usage` there would prompt for a login rather than answer, and
 * the spawn would hang until the timeout for nothing.
 */
export async function refreshAllProfileUsage(force = false): Promise<void> {
	const profiles = listClaudeProfiles().filter((p) => p.ready);
	await Promise.all(
		profiles.map((profile) =>
			refreshProfileUsage(profile.configDir, { force }).catch(() => null),
		),
	);
}

/** How often to re-ask every account while the app is running. */
const TICK_INTERVAL_MS = 10 * 60_000;

let ticker: ReturnType<typeof setInterval> | null = null;
let tickInFlight = false;

/**
 * Keep every account's numbers current for as long as GatedSpace is open.
 *
 * Without this, a snapshot is only rewritten when a turn settles in a session
 * pane on that account or a terminal renders a status line. So an account you
 * aren't actively using freezes — and worse, it freezes CONFIDENTLY: the stored
 * percentage outlives the window it described, leaving the panel showing a full
 * five-hour bar for a window that reset hours ago.
 *
 * Every tick asks the CLI, which answers `/usage` locally (`turns=0 cost=0`,
 * probed against the real binary) — no request leaves the machine, so this is
 * not the API polling the never-poll rule is about.
 */
export function startUsageRefreshTicker(): void {
	if (ticker) return;

	const tick = () => {
		// A slow or hung CLI must not stack refreshes on top of each other.
		if (tickInFlight) return;
		tickInFlight = true;
		void refreshAllProfileUsage(true)
			.catch(() => null)
			.finally(() => {
				tickInFlight = false;
			});
	};

	// Immediately, not in ten minutes: the numbers on screen at launch are
	// whatever was true when the app last closed, which can be days old.
	tick();
	ticker = setInterval(tick, TICK_INTERVAL_MS);
	// Never let a pending tick be the reason the process won't exit.
	ticker.unref?.();
}

export function stopUsageRefreshTicker(): void {
	if (!ticker) return;
	clearInterval(ticker);
	ticker = null;
}
