import type { TimelineItem } from "shared/claude-session/timeline";

/** Display budget only. Never applied to the session store or provider input. */
export const TRANSCRIPT_PAGE_SIZE = 80;
const PROMPT_LOOKBACK = 20;

/** Prefer a nearby turn boundary without mounting an unbounded tool-heavy turn. */
export function historyPageStart(
	items: readonly TimelineItem[],
	before = items.length,
): number {
	const start = Math.max(0, before - TRANSCRIPT_PAGE_SIZE);
	for (
		let index = start;
		index >= Math.max(0, start - PROMPT_LOOKBACK);
		index--
	) {
		if (items[index]?.kind === "user") return index;
	}
	return start;
}

/** Keep the prompt for a partially displayed turn, without its earlier bodies. */
export function visibleTranscriptItems(
	items: TimelineItem[],
	start: number,
): TimelineItem[] {
	if (start === 0) return items;
	const visible = items.slice(start);
	if (visible[0]?.kind !== "user") {
		for (let index = start - 1; index >= 0; index--) {
			const item = items[index];
			if (item?.kind === "user") {
				visible.unshift(item);
				break;
			}
		}
	}
	return visible;
}
