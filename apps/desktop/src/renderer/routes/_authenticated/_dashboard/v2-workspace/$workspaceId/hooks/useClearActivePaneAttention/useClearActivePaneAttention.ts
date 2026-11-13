import type { WorkspaceStore } from "@superset/panes";
import { useEffect } from "react";
import { useTerminalAgentBindings } from "renderer/hooks/host-service/useTerminalAgentBindings";
import { useV2SourcesNotificationStatus } from "renderer/hooks/host-service/useV2NotificationStatus";
import { useMarkSessionSeen } from "renderer/hooks/useSessionPaneStatuses";
import { useWorkspace } from "renderer/routes/_authenticated/_dashboard/v2-workspace/providers/WorkspaceProvider";
import {
	getV2NotificationSourcesForTab,
	useV2NotificationStore,
} from "renderer/stores/v2-notifications";
import { useStore } from "zustand";
import type { StoreApi } from "zustand/vanilla";
import type { PaneViewerData } from "../../types";

export function useClearActivePaneAttention({
	store,
}: {
	store: StoreApi<WorkspaceStore<PaneViewerData>>;
}): void {
	const { workspace } = useWorkspace();
	const activeTab = useStore(store, (state) =>
		state.tabs.find((tab) => tab.id === state.activeTabId),
	);
	const visibleTab =
		activeTab?.maximizedPaneId && activeTab.panes[activeTab.maximizedPaneId]
			? {
					...activeTab,
					panes: {
						[activeTab.maximizedPaneId]:
							activeTab.panes[activeTab.maximizedPaneId],
					},
				}
			: activeTab;
	const sources = getV2NotificationSourcesForTab(visibleTab);
	useV2SourcesNotificationStatus(workspace.id, sources);
	const markTerminalSeen = useV2NotificationStore(
		(state) => state.markTerminalSeen,
	);
	const markSessionSeen = useMarkSessionSeen();
	const bindings = useTerminalAgentBindings(workspace.id);

	useEffect(() => {
		// Only statuses describing a turn that has ALREADY ENDED get cleared.
		// `working` and `permission` are live, and clearing them would put the
		// dot out while the thing it reports is still happening.
		const acknowledge = () => {
			if (!document.hasFocus() || document.visibilityState !== "visible")
				return;
			for (const source of sources) {
				if (source.type === "session") {
					markSessionSeen(source.id);
					continue;
				}
				if (source.type !== "terminal") continue;
				// Seen marks are host-clock only: mark "seen through the binding's
				// last event". Mixing in the renderer clock would poison the
				// monotonic comparison whenever the clocks drift.
				const binding = bindings.get(source.id);
				if (!binding || binding.lastEventType !== "Stop") continue;
				markTerminalSeen(source.id, binding.lastEventAt);
			}
		};
		acknowledge();
		window.addEventListener("focus", acknowledge);
		return () => window.removeEventListener("focus", acknowledge);
	}, [sources, bindings, markTerminalSeen, markSessionSeen]);
}
