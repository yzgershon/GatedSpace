/** A quota stop is separate from a transport error or an unread completion. */
export interface UsageRecoveryState {
	id: string;
	message: string;
	/** Provider-reported reset, in Unix milliseconds. Never guessed from now. */
	resetAt: number | null;
	autoContinue: boolean;
	continuing: boolean;
	error?: string;
}

export const USAGE_CONTINUE_MESSAGE =
	"Continue from where you stopped when the usage limit was reached. Review the current state first and avoid repeating work that already completed.";

export function resetEpochMs(value: unknown): number | null {
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0)
		return null;
	const ms = value < 1e12 ? value * 1000 : value;
	return Number.isNaN(new Date(ms).getTime()) ? null : ms;
}

/** All exhausted windows must reset, not just the five-hour window. */
export function latestQuotaReset(
	windows: Array<{ used: number | null; reset: number | null }>,
	now = Date.now(),
): number | null {
	const blocked = windows.filter((w) => w.used !== null && w.used >= 100);
	if (!blocked.length || blocked.some((w) => w.reset === null)) return null;
	const future = blocked.flatMap((w) =>
		w.reset !== null && w.reset > now ? [w.reset] : [],
	);
	return future.length ? Math.max(...future) : null;
}
