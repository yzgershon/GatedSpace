/** Prior measured phase durations can estimate time; fresh machines use completed steps. */
export function phaseProgress(
	durations: Array<number | undefined>,
	index: number,
	elapsedMs: number,
) {
	if (
		!durations.every(
			(value) => value !== undefined && Number.isFinite(value) && value > 0,
		)
	) {
		return {
			completed: index,
			total: durations.length + 1,
			basis: "steps" as const,
		};
	}
	const measured = durations as number[];
	const phase = measured[index] ?? 0;
	const finished = measured
		.slice(0, index)
		.reduce((sum, value) => sum + value, 0);
	const total = measured.reduce((sum, value) => sum + value, 0) + 30_000;
	return {
		completed: finished + Math.min(Math.max(0, elapsedMs), phase * 0.9),
		total,
		basis: "timing-estimate" as const,
		// Stop claiming an ETA once this phase exceeds its measured budget.
		estimatedRemainingMs:
			elapsedMs > phase ? undefined : Math.max(0, total - finished - elapsedMs),
	};
}
