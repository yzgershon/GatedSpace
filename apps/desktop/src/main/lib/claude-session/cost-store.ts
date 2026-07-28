/**
 * Remembers what a conversation has cost, across every process that served it.
 *
 * The CLI reports `total_cost_usd` on each result, but that figure is
 * cumulative within ONE process and starts again at zero in the next. Worse,
 * it is never written to the session transcript — the stored `.jsonl` has no
 * cost field at all — so restoring a pane after a restart had nothing to
 * restore and the total began again from nothing. Between resumes, profile
 * switches and rate-limit waits, that is why the number kept resetting.
 *
 * A small sidecar file rather than a column somewhere: the transcript belongs
 * to the CLI and we do not write to it, and this is one number per session
 * that nothing else needs to join against.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { app } from "electron";

interface CostFile {
	v: number;
	/** sessionId -> cumulative USD across every run of that session. */
	sessions: Record<string, number>;
}

const VERSION = 1;

/**
 * Writes are debounced because results arrive per turn and this is a whole-file
 * rewrite. Losing the last few seconds of accrual to a hard kill costs a
 * fraction of a cent; fsyncing on every turn costs it on every turn.
 */
const FLUSH_DELAY_MS = 2_000;

let cache: CostFile | null = null;
let flushTimer: NodeJS.Timeout | null = null;

function filePath(): string {
	return path.join(app.getPath("userData"), "claude-session-cost.json");
}

function load(): CostFile {
	if (cache) return cache;
	try {
		const parsed = JSON.parse(fs.readFileSync(filePath(), "utf-8")) as CostFile;
		// A future version might mean anything; starting fresh loses history but
		// cannot report a wrong number, and a wrong cost is worse than none.
		cache =
			parsed?.v === VERSION && parsed.sessions
				? { v: VERSION, sessions: { ...parsed.sessions } }
				: { v: VERSION, sessions: {} };
	} catch {
		cache = { v: VERSION, sessions: {} };
	}
	return cache;
}

function scheduleFlush(): void {
	if (flushTimer) return;
	flushTimer = setTimeout(() => {
		flushTimer = null;
		flushCostStore();
	}, FLUSH_DELAY_MS);
	flushTimer.unref?.();
}

/** Cumulative cost recorded for a session, or 0 when it has none yet. */
export function getSessionCost(sessionId: string): number {
	return load().sessions[sessionId] ?? 0;
}

/**
 * Record the running total for a session.
 *
 * Monotonic on purpose: it takes the MAX of what is stored and what is
 * offered. A pane that restores before its stored value loads, or a second
 * pane on the same conversation reporting only its own run, would otherwise
 * push the total backwards — which is the bug this file exists to fix,
 * arriving by another door.
 */
export function recordSessionCost(sessionId: string, costUsd: number): void {
	if (!sessionId) return;
	if (!Number.isFinite(costUsd) || costUsd < 0) return;
	const store = load();
	const current = store.sessions[sessionId] ?? 0;
	if (costUsd <= current) return;
	store.sessions[sessionId] = costUsd;
	scheduleFlush();
}

/** Force a write. Called on quit so the last turn is not lost. */
export function flushCostStore(): void {
	if (!cache) return;
	try {
		fs.writeFileSync(filePath(), JSON.stringify(cache));
	} catch {
		// A cost figure is not worth surfacing an error over; it will be rewritten
		// on the next turn.
	}
}

/** Test seam. */
export function resetCostStoreCache(): void {
	cache = null;
	if (flushTimer) {
		clearTimeout(flushTimer);
		flushTimer = null;
	}
}
