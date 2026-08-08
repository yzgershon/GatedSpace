/**
 * A cross-process claim on one Claude session id.
 *
 * Lives in `@superset/shared` because BOTH writers have to agree on it: the
 * desktop session panes (`apps/desktop`, main process) and the ACP runtime
 * (`packages/host-service`). A copy on either side alone protects nothing —
 * the whole mechanism is that two processes touch the same files.
 *
 * The desktop's `resume-claim` answers "does another PANE hold this id", which
 * is a map lookup because every pane lives in one process. That is no longer
 * the whole question: ACP sessions run in the host service and write to the
 * SAME transcripts under `~/.claude/projects` (measured 2026-08-05 — an ACP run
 * left nine new files in that store). Two live writers on one transcript is
 * what destroyed conversations on 7/18 and 7/19.
 *
 * The obvious fix — ask the host service for its live ids and union them — does
 * not fit: `SessionManager.start` is synchronous, so the answer would have to
 * come from a cache refreshed on a timer. A cache that is stale or not yet
 * populated reads as "nobody holds this", which means the guard fails OPEN in
 * exactly the case it exists for. A check that silently does nothing is the
 * same failure as the pinned prompt's clamp, and here it costs a transcript.
 *
 * So the claim lives in the filesystem instead. `writeFileSync` with `wx` is an
 * atomic create-or-fail that both processes can call synchronously, with no
 * broker between them, and it extends to any future writer without either side
 * knowing the other exists.
 *
 * Failure policy, deliberately asymmetric:
 * - block ONLY on positively reading a live holder;
 * - on any infrastructure failure (unreadable dir, malformed lock, EPERM),
 *   allow the session. A lock that can brick the app the moment a disk hiccups
 *   is worse than the rare race it guards.
 */
import {
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";

/** Who is holding a session id, as recorded in the lock file. */
export interface LockHolder {
	/** OS process id of the holder. */
	pid: number;
	/**
	 * Which writer this is — "pane" here, "acp" from the host service. Carried
	 * for humans reading a stuck lock; nothing branches on it.
	 */
	kind: string;
	/** ms epoch the lock was taken, for debugging a stuck one. */
	at: number;
}

export type LockResult =
	| { ok: true }
	/** Refused: `heldBy` is the live holder that already has it. */
	| { ok: false; heldBy: LockHolder };

/**
 * Session ids are uuids from the CLI, but this is the boundary where one
 * becomes a filename — so a malformed id must never be able to escape the lock
 * directory. Anything outside this shape is treated as unlockable and allowed
 * through rather than silently written somewhere unexpected.
 */
const SAFE_ID = /^[a-zA-Z0-9._-]+$/;

function lockPath(dir: string, sessionId: string): string | null {
	if (!SAFE_ID.test(sessionId)) return null;
	return join(dir, `${sessionId}.lock`);
}

function parseHolder(raw: string): LockHolder | null {
	try {
		const value = JSON.parse(raw) as Partial<LockHolder>;
		if (typeof value.pid !== "number" || !Number.isFinite(value.pid)) {
			return null;
		}
		return {
			pid: value.pid,
			kind: typeof value.kind === "string" ? value.kind : "unknown",
			at: typeof value.at === "number" ? value.at : 0,
		};
	} catch {
		return null;
	}
}

/** Whether a pid is a running process. The default for real callers. */
export function pidIsAlive(pid: number): boolean {
	try {
		// Signal 0 performs the permission/existence check without delivering
		// anything. Throws ESRCH when no such process exists.
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

/**
 * Take the lock for `sessionId`, or report who already holds it.
 *
 * A lock whose holder is gone is stolen rather than honoured: a crashed process
 * must not block a legitimate resume forever, which is the same rule that scopes
 * `resume-claim` to keys that are actually live.
 */
export function acquireSessionLock(
	dir: string,
	sessionId: string,
	holder: Omit<LockHolder, "at"> & { at?: number },
	isAlive: (pid: number) => boolean = pidIsAlive,
): LockResult {
	const path = lockPath(dir, sessionId);
	if (!path) return { ok: true };
	const record: LockHolder = {
		pid: holder.pid,
		kind: holder.kind,
		at: holder.at ?? Date.now(),
	};
	const payload = JSON.stringify(record);

	for (let attempt = 0; attempt < 2; attempt++) {
		try {
			mkdirSync(dir, { recursive: true });
			writeFileSync(path, payload, { encoding: "utf8", flag: "wx" });
			return { ok: true };
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code !== "EEXIST") {
				// Not a contention failure. Allow the session; see the failure
				// policy at the top of this file.
				return { ok: true };
			}
			let existing: LockHolder | null = null;
			try {
				existing = parseHolder(readFileSync(path, "utf8"));
			} catch {
				existing = null;
			}
			// Re-entrant by design: the same process re-resuming its own id (a
			// mode change respawns under the same key) must not deadlock itself.
			if (existing && existing.pid !== record.pid && isAlive(existing.pid)) {
				return { ok: false, heldBy: existing };
			}
			// Unreadable, malformed, ours, or owned by a process that is gone.
			try {
				rmSync(path, { force: true });
			} catch {
				return { ok: true };
			}
		}
	}
	return { ok: true };
}

/**
 * Drop our claim. Never removes a lock another process owns — a late release
 * from a dying session would otherwise unlock the successor that just took it.
 */
export function releaseSessionLock(
	dir: string,
	sessionId: string,
	pid: number,
): void {
	const path = lockPath(dir, sessionId);
	if (!path) return;
	try {
		const existing = parseHolder(readFileSync(path, "utf8"));
		if (existing && existing.pid !== pid) return;
		rmSync(path, { force: true });
	} catch {
		// Already gone, or unreadable. Either way there is nothing to release.
	}
}

/**
 * Every session id currently claimed by a LIVE holder, from either process.
 *
 * The lock directory is already the union of both sides' claims, so the
 * recent-sessions list can ask this one question instead of the desktop
 * exposing an endpoint and the host service exposing another. Dead holders are
 * filtered rather than reported: an id whose owner crashed is resumable, and
 * listing it would grey out a session the user can legitimately open.
 *
 * Unlike `acquireSessionLock` this is advisory — it feeds a UI that only needs
 * to be right most of the time, and a few seconds of staleness costs nothing.
 * The correctness guarantee lives in the atomic acquire, not here.
 */
export function listHeldSessionIds(
	dir: string,
	isAlive: (pid: number) => boolean = pidIsAlive,
): string[] {
	let names: string[];
	try {
		names = readdirSync(dir);
	} catch {
		// No directory yet means nothing has ever been claimed.
		return [];
	}
	const held: string[] = [];
	for (const name of names) {
		if (!name.endsWith(".lock")) continue;
		const sessionId = name.slice(0, -".lock".length);
		let holder: LockHolder | null = null;
		try {
			holder = parseHolder(readFileSync(join(dir, name), "utf8"));
		} catch {
			continue;
		}
		if (holder && isAlive(holder.pid)) held.push(sessionId);
	}
	return held;
}

/** The current holder of an id, or null when it is free. Diagnostics only. */
export function readSessionLock(
	dir: string,
	sessionId: string,
): LockHolder | null {
	const path = lockPath(dir, sessionId);
	if (!path) return null;
	try {
		return parseHolder(readFileSync(path, "utf8"));
	} catch {
		return null;
	}
}
