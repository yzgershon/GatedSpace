// Disk backstop for terminal output. The daemon's replay ring buffer is tiny
// (~64 KB, in-memory only) and the full scrollback lives in the renderer's
// xterm — so before this logger existed, a killed daemon (app update, crash,
// reboot) could take the only copy of an agent conversation with it, when the
// agent's own transcript was never written (see the 2026-07-18/19 session-loss
// incidents).
//
// The logger appends every output byte of every session to
// `<dir>/<sessionId>.log`, batched and flushed on a short interval. Files
// rotate once (`<sessionId>.1.log`) at the size cap and are swept after the
// retention window. Raw pty bytes are logged as-is — ANSI sequences included —
// because fidelity beats prettiness for a recovery artifact.
//
// Failure policy: logging must never break the pty path. Any filesystem error
// disables the failing session's log (or the whole logger when the dir can't
// be created) with a single stderr warning.

import * as fs from "node:fs";
import * as path from "node:path";

export const DEFAULT_MAX_FILE_BYTES = 16 * 1024 * 1024;
export const DEFAULT_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
const FLUSH_INTERVAL_MS = 1_000;
const MAX_PENDING_BYTES = 256 * 1024;

interface SessionLogState {
	pending: Buffer[];
	pendingBytes: number;
	/** Approximate size of the active log file (seeded from stat on first append). */
	fileBytes: number;
	failed: boolean;
}

export interface SessionLoggerOptions {
	maxFileBytes?: number;
	retentionMs?: number;
}

export class SessionLogger {
	private readonly dir: string;
	private readonly maxFileBytes: number;
	private readonly states = new Map<string, SessionLogState>();
	private timer: NodeJS.Timeout | null = null;
	private ready = false;

	constructor(dir: string, opts: SessionLoggerOptions = {}) {
		this.dir = dir;
		this.maxFileBytes = opts.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
		try {
			fs.mkdirSync(dir, { recursive: true });
			this.ready = true;
			this.sweep(opts.retentionMs ?? DEFAULT_RETENTION_MS);
		} catch (err) {
			process.stderr.write(
				`[pty-daemon] session logging disabled (${(err as Error).message})\n`,
			);
		}
	}

	append(sessionId: string, chunk: Buffer): void {
		if (!this.ready || chunk.byteLength === 0) return;
		let state = this.states.get(sessionId);
		if (!state) {
			state = {
				pending: [],
				pendingBytes: 0,
				fileBytes: this.statFileBytes(sessionId),
				failed: false,
			};
			this.states.set(sessionId, state);
		}
		if (state.failed) return;
		state.pending.push(chunk);
		state.pendingBytes += chunk.byteLength;
		if (state.pendingBytes >= MAX_PENDING_BYTES) {
			this.flushSession(sessionId, state);
		} else {
			this.ensureTimer();
		}
	}

	/** Flush the session's tail; the file itself is the recovery artifact and stays. */
	sessionExited(sessionId: string): void {
		const state = this.states.get(sessionId);
		if (state) {
			this.flushSession(sessionId, state);
			this.states.delete(sessionId);
		}
	}

	/** Flush everything (daemon shutdown / handoff). */
	closeAll(): void {
		for (const [sessionId, state] of this.states) {
			this.flushSession(sessionId, state);
		}
		this.states.clear();
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
		}
	}

	logPath(sessionId: string): string {
		return path.join(this.dir, `${sessionId}.log`);
	}

	private statFileBytes(sessionId: string): number {
		try {
			return fs.statSync(this.logPath(sessionId)).size;
		} catch {
			return 0;
		}
	}

	private ensureTimer(): void {
		if (this.timer) return;
		this.timer = setInterval(() => {
			for (const [sessionId, state] of this.states) {
				this.flushSession(sessionId, state);
			}
		}, FLUSH_INTERVAL_MS);
		// Never keep the daemon alive just to flush logs.
		this.timer.unref();
	}

	private flushSession(sessionId: string, state: SessionLogState): void {
		if (state.failed || state.pendingBytes === 0) return;
		const data = Buffer.concat(state.pending);
		state.pending = [];
		state.pendingBytes = 0;
		const logPath = this.logPath(sessionId);
		try {
			if (state.fileBytes + data.byteLength > this.maxFileBytes) {
				// Single-slot rotation: previous generation is replaced, so a
				// session occupies at most ~2× maxFileBytes on disk.
				const rotated = path.join(this.dir, `${sessionId}.1.log`);
				fs.rmSync(rotated, { force: true });
				if (fs.existsSync(logPath)) fs.renameSync(logPath, rotated);
				state.fileBytes = 0;
			}
			fs.appendFileSync(logPath, data);
			state.fileBytes += data.byteLength;
		} catch (err) {
			state.failed = true;
			process.stderr.write(
				`[pty-daemon] session log write failed for ${sessionId}, disabling (${(err as Error).message})\n`,
			);
		}
	}

	private sweep(retentionMs: number): void {
		const cutoff = Date.now() - retentionMs;
		let entries: string[];
		try {
			entries = fs.readdirSync(this.dir);
		} catch {
			return;
		}
		for (const entry of entries) {
			if (!entry.endsWith(".log")) continue;
			const full = path.join(this.dir, entry);
			try {
				if (fs.statSync(full).mtimeMs < cutoff)
					fs.rmSync(full, { force: true });
			} catch {
				// racing another process or a locked file — leave it for next sweep
			}
		}
	}
}
