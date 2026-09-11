import { useCallback, useSyncExternalStore } from "react";
import {
	getSessionActivity,
	getSessionActivityVersion,
	subscribeSessionActivity,
} from "renderer/stores/session-activity";
import { useV2NotificationStore } from "renderer/stores/v2-notifications";
import type { PaneStatus } from "shared/tabs-types";
import { deriveSessionPaneStatus } from "./deriveSessionPaneStatus";

/**
 * Live status for one Claude session pane, ready for a status dot.
 *
 * Subscribes to the activity store by VERSION rather than by pane, which keeps
 * `useSyncExternalStore`'s snapshot a primitive (so React can compare it) at
 * the cost of a re-render when any session changes. Cheap: the store only
 * notifies when a pane's status or finished-turn id actually changes, not on
 * every streamed token.
 */
export function useSessionPaneStatus(paneId: string | undefined): PaneStatus {
	useSyncExternalStore(subscribeSessionActivity, getSessionActivityVersion);
	const seenTurn = useV2NotificationStore((state) =>
		paneId ? state.sessionSeenTurn[paneId] : undefined,
	);
	if (!paneId) return "idle";
	return deriveSessionPaneStatus({
		activity: getSessionActivity(paneId),
		seenTurn,
	});
}

/**
 * The same derivation over a set of pane ids, for callers aggregating a tab or
 * a workspace. Returns a lookup rather than a single status so the caller can
 * fold it however it likes.
 */
export function useSessionPaneStatuses(
	paneIds: readonly string[],
): Map<string, PaneStatus> {
	useSyncExternalStore(subscribeSessionActivity, getSessionActivityVersion);
	const sessionSeenTurn = useV2NotificationStore(
		(state) => state.sessionSeenTurn,
	);
	// Not memoized on `paneIds`: callers build that array inline from the tab's
	// panes, so its identity changes every render anyway and a useMemo here
	// would cost a dependency comparison to cache nothing.
	const statuses = new Map<string, PaneStatus>();
	for (const paneId of paneIds) {
		statuses.set(
			paneId,
			deriveSessionPaneStatus({
				activity: getSessionActivity(paneId),
				seenTurn: sessionSeenTurn[paneId],
			}),
		);
	}
	return statuses;
}

/**
 * Marks a session pane's current completion as seen. Safe to call repeatedly —
 * the store ignores a mark that matches what it already has, and a pane with
 * nothing finished has no turn to mark.
 */
export function useMarkSessionSeen(): (paneId: string) => void {
	const markSessionSeen = useV2NotificationStore(
		(state) => state.markSessionSeen,
	);
	return useCallback(
		(paneId: string) => {
			const turnKey = getSessionActivity(paneId)?.turnKey;
			if (!turnKey) return;
			markSessionSeen(paneId, turnKey);
		},
		[markSessionSeen],
	);
}
