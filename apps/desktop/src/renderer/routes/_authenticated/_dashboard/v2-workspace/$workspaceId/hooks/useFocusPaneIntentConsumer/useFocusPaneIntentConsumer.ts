/**
 * Brings forward a pane the sidebar asked for.
 *
 * The workspace-side half of `focus-pane-intent`: it lives where `store`
 * exists, watches the intent, and acts.
 *
 * BOTH `setActiveTab` and `setActivePane` are called, because a pane sitting in
 * a background tab needs its tab brought forward before focusing the pane does
 * anything visible — the same pair the tab hover card's rows call, for the same
 * reason.
 */
import type { WorkspaceStore } from "@superset/panes";
import { useEffect, useRef } from "react";
import { useFocusPaneIntent } from "renderer/stores/focus-pane-intent";
import type { StoreApi } from "zustand/vanilla";
import type { PaneViewerData } from "../../types";

export function useFocusPaneIntentConsumer({
	store,
}: {
	store: StoreApi<WorkspaceStore<PaneViewerData>>;
}): void {
	const tick = useFocusPaneIntent((state) => state.tick);
	// Ignore the tick this hook mounts on. Without it, remounting the workspace
	// would replay whatever pane was last asked for and yank focus on every
	// route change.
	const lastHandledTick = useRef(tick);

	useEffect(() => {
		if (tick === lastHandledTick.current) return;
		lastHandledTick.current = tick;

		const { paneId, clear } = useFocusPaneIntent.getState();
		if (!paneId) return;
		clear();

		// Resolved against THIS workspace's tabs. The intent carries no workspace
		// id, so a pane belonging to another workspace simply is not found here —
		// which is the wanted behaviour, not a missing check.
		const state = store.getState();
		const tab = state.tabs.find((candidate) => paneId in candidate.panes);
		if (!tab) return;
		state.setActiveTab(tab.id);
		state.setActivePane({ tabId: tab.id, paneId });
	}, [tick, store]);
}
