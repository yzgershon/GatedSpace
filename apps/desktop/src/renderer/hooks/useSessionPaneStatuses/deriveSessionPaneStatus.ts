import type { SessionActivity } from "renderer/stores/session-activity";
import type { PaneStatus } from "shared/tabs-types";

/**
 * Turn a session pane's activity into the dot the tab shows.
 *
 *   streaming        → working     (amber, pulsing — it's thinking)
 *   done, unseen     → review      (green — go read it)
 *   error, unseen    → error       (red — it died)
 *   done/error, seen → idle        (no dot; you've already looked)
 *   idle             → idle
 *
 * `streaming` is deliberately NOT seen-gated. It describes something happening
 * right now rather than something you missed, so it stays lit while you watch
 * it and goes out on its own when the turn ends.
 */
export function deriveSessionPaneStatus({
	activity,
	seenTurn,
}: {
	activity: SessionActivity | undefined;
	seenTurn: string | undefined;
}): PaneStatus {
	if (!activity) return "idle";
	if (activity.status === "streaming") return "working";
	if (activity.status !== "done" && activity.status !== "error") return "idle";
	// A settled status with no finished turn behind it is a session restored
	// from disk, not a completion the user missed — `settled()` folds stored
	// transcripts to `idle`, but a fold that ends mid-turn can still land here.
	// Treat it as nothing to report rather than lighting a dot for a
	// conversation that finished days ago.
	if (!activity.turnKey) return "idle";
	if (activity.turnKey === seenTurn) return "idle";
	return activity.status === "error" ? "error" : "review";
}
