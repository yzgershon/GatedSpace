/**
 * Where launch time actually goes.
 *
 * Launch was slow for four separate reasons and only one of them was obvious
 * from reading the code. The rest of the budget is spread across phases that
 * each look cheap, so the next second saved should come from a measurement
 * rather than another guess.
 *
 * Timings are relative to PROCESS START, not to when this module loaded —
 * `process.uptime()` includes Electron's own boot, which is part of what the
 * user waits through and would otherwise be invisible.
 *
 * Written through electron-log, NOT console. An installed app has no terminal
 * attached, and electron-log's file transport only records its own calls — so
 * the first version of this logged to nowhere on exactly the build where the
 * numbers were wanted. These land in the same main.log the host-service
 * coordinator writes to.
 */
import log from "electron-log/main";

function sinceProcessStart(): number {
	return Math.round(process.uptime() * 1000);
}

/**
 * Record that a startup milestone has been reached.
 *
 * Never throws. Some callers run at MODULE IMPORT — before `app.whenReady()`,
 * and in the case of local-db before anything else in the app exists. A
 * measurement that can prevent the app from starting is worse than no
 * measurement, and the same reasoning ruled out `electron-log/renderer` for the
 * renderer half of this.
 */
export function markStartup(label: string): void {
	try {
		log.info(`[startup] +${sinceProcessStart()}ms ${label}`);
	} catch {
		// Logging unavailable this early — the milestone is not worth a crash.
	}
}

/**
 * Run a startup phase and report how long it blocked.
 *
 * Reports on the failure path too: a phase that throws still consumed the
 * time, and a slow phase that also fails is the most useful thing to see.
 */
export async function timeStartupPhase<T>(
	label: string,
	run: () => Promise<T>,
): Promise<T> {
	const startedAt = sinceProcessStart();
	try {
		return await run();
	} finally {
		const finishedAt = sinceProcessStart();
		markStartup(`${label} took ${finishedAt - startedAt}ms`);
	}
}
