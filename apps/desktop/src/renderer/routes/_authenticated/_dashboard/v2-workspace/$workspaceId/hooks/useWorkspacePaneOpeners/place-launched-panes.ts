import type { CreatePaneInput, WorkspaceStore } from "@superset/panes";
import type { PaneLaunchTarget } from "renderer/stores/tabs/preset-launch";
import type { StoreApi } from "zustand/vanilla";

/** Fill the chosen slot without rearranging its siblings or consulting new focus. */
export function placeLaunchedPanes<T>(
	store: StoreApi<WorkspaceStore<T>>,
	panes: [CreatePaneInput<T>, ...CreatePaneInput<T>[]],
	target?: PaneLaunchTarget,
) {
	const state = store.getState();
	const tab = target && state.getTab(target.tabId);
	if (!tab || !target) {
		state.addTab({ panes });
		return;
	}
	const [first, ...rest] = panes;
	const chooser = tab.panes[target.paneId];
	if (chooser?.kind === "new-tab" && !chooser.pinned) {
		state.replacePane({ tabId: tab.id, paneId: chooser.id, newPane: first });
	} else {
		state.addPane({ tabId: tab.id, pane: first });
	}
	for (const pane of rest) state.addPane({ tabId: tab.id, pane });
}
