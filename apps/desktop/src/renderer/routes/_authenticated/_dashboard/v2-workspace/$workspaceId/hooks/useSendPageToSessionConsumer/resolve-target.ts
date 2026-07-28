/**
 * Which Claude session a captured page should land in.
 *
 * Separated from the hook so the rules can be tested without a workspace
 * store: getting this wrong is quiet rather than loud — a screenshot in the
 * wrong conversation still looks like it worked.
 */

export interface SessionPaneCandidates {
	/** Pane id of the focused pane, when it is a session pane. */
	activeSessionPaneId?: string;
	/** Ids of every open session pane, focused or not. */
	allSessionPaneIds: string[];
}

export type TargetResolution =
	| { paneId: string }
	| { error: "none-open" | "ambiguous" };

export function resolveTarget(input: SessionPaneCandidates): TargetResolution {
	// The focused pane wins: that is a choice the user just made, and it should
	// beat any inference drawn from the rest of the layout.
	if (input.activeSessionPaneId) return { paneId: input.activeSessionPaneId };
	if (input.allSessionPaneIds.length === 1) {
		return { paneId: input.allSessionPaneIds[0] as string };
	}
	if (input.allSessionPaneIds.length === 0) return { error: "none-open" };
	// Several open, none focused. Picking the first would be a coin flip
	// dressed up as a decision.
	return { error: "ambiguous" };
}

export function targetErrorMessage(error: "none-open" | "ambiguous"): string {
	return error === "none-open"
		? "Open a Claude session first."
		: "Click the session you want it in, then try again.";
}
