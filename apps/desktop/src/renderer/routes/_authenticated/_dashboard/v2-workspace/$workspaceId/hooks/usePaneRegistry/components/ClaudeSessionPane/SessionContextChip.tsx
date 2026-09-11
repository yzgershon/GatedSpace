/**
 * How full this pane's context is, in the pane's own header.
 *
 * It was in the meta strip — the second row under the title that also carried
 * the account, two usage meters, a reset time, the permission mode and an MCP
 * count — and it went out with the strip when Liquid Glass set
 * `metaStrip: "none"`. The comment left behind said the number had moved to sit
 * beside the engine label in the composer. It had not: the composer grew the
 * props in the same commit and nothing ever passed them, so the readout existed
 * at both ends and rendered at neither.
 *
 * It is back here rather than in the composer because it is a property of the
 * PANE, and at four-up the answer to "which of these is nearly full" should be
 * on the same row as the name of the thing that is full.
 *
 * Absolute counts, not a share of the window: the thresholds used to be 70% and
 * 90% of whatever the model reported, which on a 1M window meant no warning at
 * all until 700k — well past the point where you would have acted.
 */
import { cn } from "@superset/ui/utils";
import { useSyncExternalStore } from "react";
import { getSessionSnapshot, subscribeSession } from "./sessionStore";

const CONTEXT_WARN_TOKENS = 400_000;
const CONTEXT_DANGER_TOKENS = 750_000;

export function formatContextTokens(count: number): string {
	if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
	if (count >= 1_000) return `${Math.round(count / 1_000)}k`;
	return String(count);
}

export function contextToneClass(contextTokens: number): string {
	if (contextTokens >= CONTEXT_DANGER_TOKENS) return "text-destructive";
	if (contextTokens >= CONTEXT_WARN_TOKENS) return "text-warning";
	return "text-muted-foreground/45";
}

export function SessionContextChip({ paneId }: { paneId: string }) {
	/*
	 * Two primitive snapshots rather than the usage object.
	 *
	 * `useSyncExternalStore` compares by reference, and the timeline builds a
	 * fresh `usage` on every token of a streaming turn. Returning it would
	 * re-render this chip on every frame of every turn to print the same string.
	 */
	const contextTokens = useSyncExternalStore(
		(callback) => subscribeSession(paneId, callback),
		() => getSessionSnapshot(paneId).timeline.usage?.contextTokens ?? -1,
	);
	const contextWindow = useSyncExternalStore(
		(callback) => subscribeSession(paneId, callback),
		() => getSessionSnapshot(paneId).timeline.usage?.contextWindow ?? 0,
	);

	// -1 rather than 0 for "no turn yet": a session genuinely can report 0 used,
	// and that is worth printing, whereas a session that has not answered once
	// has nothing to say.
	if (contextTokens < 0) return null;

	return (
		<span
			className={cn(
				"shrink-0 text-[11.5px] tabular-nums",
				contextToneClass(contextTokens),
			)}
			title={
				contextWindow
					? `${contextTokens.toLocaleString()} of ${contextWindow.toLocaleString()} context tokens used`
					: `${contextTokens.toLocaleString()} context tokens used`
			}
		>
			{formatContextTokens(contextTokens)}
			{contextWindow ? ` / ${formatContextTokens(contextWindow)}` : ""}
		</span>
	);
}
