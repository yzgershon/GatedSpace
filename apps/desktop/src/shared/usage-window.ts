/**
 * Reading a stored usage window as of RIGHT NOW, rather than as of whenever it
 * was written.
 *
 * The bug this fixes: a five-hour window that has passed its reset moment kept
 * showing the percentage from the window before it. The panel read "100% used"
 * and "resets now" at the same time — two statements that contradict each other,
 * because the first was hours old and the second was the clock catching up to a
 * timestamp nobody re-checked. It looks like a broken meter, and worse, it looks
 * like you are still out of quota when you are not.
 *
 * The stored snapshot is only true until its own reset moment. Past that, the
 * window rolled over and the honest reading is zero.
 *
 * What this deliberately does NOT do is invent the next reset time. It is
 * tempting to add five hours and show a fresh countdown, but the next window
 * does not begin on a fixed schedule — it begins when you next send something.
 * A projected countdown would be a confident guess, which is the exact failure
 * mode being fixed here. So a rolled-over window reports no reset time, the
 * formatter renders no countdown, and real numbers replace this within one
 * refresh tick.
 */

/** A window as persisted in `cache/rate-limits.json`. */
export interface StoredUsageWindow {
	used_percentage?: number | null;
	/** Unix SECONDS. */
	resets_at?: number | null;
	resets_label?: string | null;
}

export interface EffectiveUsageWindow {
	usedPercent: number | null;
	/** Unix seconds. Null once rolled over — see the note above. */
	resetsAt: number | null;
	resetsLabel: string | null;
	/** True when the stored window had already elapsed and was zeroed. */
	rolledOver: boolean;
}

function isRecord(value: unknown): value is StoredUsageWindow {
	return typeof value === "object" && value !== null;
}

/**
 * Resolve a stored window against the current time.
 *
 * Returns null when there is nothing usable to show, which callers already treat
 * as "no data for this account yet".
 */
export function resolveUsageWindow(
	stored: unknown,
	nowMs: number,
): EffectiveUsageWindow | null {
	if (!isRecord(stored)) return null;

	const usedPercent =
		typeof stored.used_percentage === "number"
			? Math.round(stored.used_percentage)
			: null;
	const resetsAt =
		typeof stored.resets_at === "number" ? stored.resets_at : null;
	const resetsLabel =
		typeof stored.resets_label === "string" && stored.resets_label.trim()
			? stored.resets_label
			: null;

	if (usedPercent === null && resetsAt === null && resetsLabel === null) {
		return null;
	}

	// `<=`, not `<`: at the reset moment itself the window has already rolled.
	// That instant is exactly when the old display read "100% used · resets now".
	const hasElapsed = resetsAt !== null && resetsAt * 1000 <= nowMs;
	if (hasElapsed) {
		return {
			usedPercent: 0,
			// Both cleared: they describe the window that just ended, and keeping
			// either would date-stamp a zero with an expired moment.
			resetsAt: null,
			resetsLabel: null,
			rolledOver: true,
		};
	}

	return { usedPercent, resetsAt, resetsLabel, rolledOver: false };
}
