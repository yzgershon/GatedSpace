/**
 * Did the last run crash, and what did it look like when it did?
 *
 * Electron tells you a renderer died; it does not tell you the app itself was
 * killed, and it cannot tell you anything at all once the process is gone. So
 * this writes a heartbeat file while running and stamps an EXPECTED exit on the
 * way out. On the next launch, a heartbeat with no expected-exit stamp means
 * the previous run died without getting to say goodbye.
 *
 * Two design decisions worth keeping:
 *
 * 1. **Expected exits must be stamped, or your crash rate becomes your own
 *    updater.** Quitting, relaunching for an update, and being asked to restart
 *    are all normal. Without a stamp they are indistinguishable from an access
 *    violation, and the resulting "crash" numbers describe nothing.
 *
 * 2. **Everything persisted is a BUCKET, never a raw value.** `<500MB` rather
 *    than 481203712, `2-4` rather than 3. Buckets group cleanly when several
 *    reports are compared, they carry no incidental detail about the machine,
 *    and — the actual reason — they are usable directly as a policy input at
 *    next boot. A restore policy wants "was memory pressure high", not a byte
 *    count it would have to threshold at read time in three places.
 *
 * The file is small, written atomically, and a corrupt or absent one is simply
 * "no previous session" — diagnostics must never be able to stop a launch.
 */
import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { SUPERSET_HOME_DIR } from "./app-environment";

/** Bumped when the shape changes; an unknown version reads as no session. */
const SENTINEL_VERSION = 1;
const SENTINEL_PATH = join(SUPERSET_HOME_DIR, "session.alive.v1.json");

/** How often the heartbeat is rewritten while the app runs. */
const HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * Why the previous run ended, when it ended on purpose. `null` on disk means it
 * didn't — which is the whole signal.
 */
export type ExpectedExit = "quit" | "updater-restart" | "user-restart";

export interface SentinelDiagnostics {
	/** Resident set size, bucketed. */
	memory: string;
	/** Live terminal count, bucketed. */
	terminals: string;
	/** How long the run lasted, bucketed. */
	runtime: string;
}

export interface PreviousSession {
	release: string;
	platform: string;
	arch: string;
	/** True when the run ended without stamping an expected exit. */
	crashed: boolean;
	expectedExit: ExpectedExit | null;
	diagnostics: SentinelDiagnostics;
	/**
	 * True when the run never saw a single meaningful user action. "Died before
	 * the user did anything" is a different bug from "died after eight hours"
	 * and deserves to be a separate class, not an average.
	 */
	activityWasNone: boolean;
}

interface SentinelFile {
	version: number;
	pid: number;
	release: string;
	platform: string;
	arch: string;
	startedAtMs: number;
	lastHeartbeatAtMs: number;
	expectedExit: ExpectedExit | null;
	lastActivity: string | null;
	diagnostics: SentinelDiagnostics;
}

/** Bucket bytes. Boundaries chosen to straddle the sizes that actually hurt. */
export function bucketMemory(bytes: number): string {
	const mb = bytes / (1024 * 1024);
	if (mb < 500) return "<500MB";
	if (mb < 1024) return "0.5-1GB";
	if (mb < 2048) return "1-2GB";
	if (mb < 4096) return "2-4GB";
	return ">4GB";
}

/** Bucket a count. Same scale used for terminals and for restore planning. */
export function bucketCount(count: number): string {
	if (count <= 0) return "0";
	if (count === 1) return "1";
	if (count <= 4) return "2-4";
	if (count <= 9) return "5-9";
	if (count <= 19) return "10-19";
	return "20+";
}

/**
 * Bucket a duration. A crash at 30s is a startup bug; a crash at 8h is a leak.
 * The buckets exist so those two never average into one meaningless number.
 */
export function bucketRuntime(ms: number): string {
	const minutes = ms / 60_000;
	if (minutes < 0.5) return "30s";
	if (minutes < 2) return "2min";
	if (minutes < 5) return "5min";
	if (minutes < 15) return "15min";
	if (minutes < 30) return "30min";
	if (minutes < 60) return "1h";
	if (minutes < 120) return "2h";
	if (minutes < 240) return "4h";
	if (minutes < 480) return "8h";
	return "16h+";
}

function readSentinel(): SentinelFile | null {
	try {
		if (!existsSync(SENTINEL_PATH)) return null;
		const parsed: unknown = JSON.parse(readFileSync(SENTINEL_PATH, "utf8"));
		if (!parsed || typeof parsed !== "object") return null;
		const file = parsed as SentinelFile;
		if (file.version !== SENTINEL_VERSION) return null;
		return file;
	} catch {
		// A truncated or hand-edited file is "no previous session", never a throw.
		return null;
	}
}

/** Write atomically: a watcher or the next launch must never see half a file. */
function writeSentinel(file: SentinelFile): void {
	try {
		mkdirSync(dirname(SENTINEL_PATH), { recursive: true });
		const tmp = `${SENTINEL_PATH}.tmp`;
		writeFileSync(tmp, JSON.stringify(file, null, 2), "utf8");
		renameSync(tmp, SENTINEL_PATH);
	} catch {
		// Diagnostics are never worth failing a launch or a quit over.
	}
}

class CrashSentinel {
	private file: SentinelFile | null = null;
	private timer: ReturnType<typeof setInterval> | null = null;
	private previous: PreviousSession | null = null;
	private terminalCount = 0;
	private sawActivity = false;

	/**
	 * Read the previous run's verdict, then begin recording this one. Returns
	 * what the last session looked like, or null if there wasn't one.
	 */
	start(release: string): PreviousSession | null {
		const prior = readSentinel();
		if (prior) {
			this.previous = {
				release: prior.release,
				platform: prior.platform,
				arch: prior.arch,
				// The signal: a heartbeat exists but nothing stamped an exit.
				crashed: prior.expectedExit === null,
				expectedExit: prior.expectedExit,
				diagnostics: prior.diagnostics,
				activityWasNone: !prior.lastActivity,
			};
		}

		const now = Date.now();
		this.file = {
			version: SENTINEL_VERSION,
			pid: process.pid,
			release,
			platform: process.platform,
			arch: process.arch,
			startedAtMs: now,
			lastHeartbeatAtMs: now,
			expectedExit: null,
			lastActivity: null,
			diagnostics: this.snapshot(now),
		};
		writeSentinel(this.file);

		this.timer = setInterval(() => this.beat(), HEARTBEAT_INTERVAL_MS);
		// Never let the heartbeat be the reason the process won't exit.
		this.timer.unref?.();

		return this.previous;
	}

	/** What the previous run looked like. Null when there wasn't one. */
	getPreviousSession(): PreviousSession | null {
		return this.previous;
	}

	/** Terminal count feeds the bucket; the restore planner reads it back. */
	setTerminalCount(count: number): void {
		this.terminalCount = count;
	}

	/**
	 * Mark that the user actually did something. Distinguishes "crashed on
	 * startup" from "crashed during use" without recording WHAT they did.
	 */
	noteActivity(): void {
		if (this.sawActivity) return;
		this.sawActivity = true;
		if (!this.file) return;
		this.file.lastActivity = "user";
		writeSentinel(this.file);
	}

	/**
	 * Stamp an expected exit. Call this on quit and BEFORE an updater relaunch —
	 * an unstamped updater restart reads as a crash and will dominate the numbers.
	 */
	expectExit(reason: ExpectedExit): void {
		if (!this.file) return;
		this.file.expectedExit = reason;
		this.file.lastHeartbeatAtMs = Date.now();
		this.file.diagnostics = this.snapshot(Date.now());
		writeSentinel(this.file);
	}

	/** Clear a stamp that turned out not to apply (an update that didn't happen). */
	clearExpectedExit(): void {
		if (!this.file || this.file.expectedExit === null) return;
		this.file.expectedExit = null;
		writeSentinel(this.file);
	}

	stop(): void {
		if (!this.timer) return;
		clearInterval(this.timer);
		this.timer = null;
	}

	/** Remove the file entirely — used by tests. */
	reset(): void {
		this.stop();
		this.file = null;
		this.previous = null;
		try {
			if (existsSync(SENTINEL_PATH)) unlinkSync(SENTINEL_PATH);
		} catch {
			// Best effort.
		}
	}

	private beat(): void {
		if (!this.file) return;
		const now = Date.now();
		this.file.lastHeartbeatAtMs = now;
		this.file.diagnostics = this.snapshot(now);
		writeSentinel(this.file);
	}

	private snapshot(now: number): SentinelDiagnostics {
		const started = this.file?.startedAtMs ?? now;
		return {
			memory: bucketMemory(process.memoryUsage().rss),
			terminals: bucketCount(this.terminalCount),
			runtime: bucketRuntime(now - started),
		};
	}
}

export const crashSentinel = new CrashSentinel();
