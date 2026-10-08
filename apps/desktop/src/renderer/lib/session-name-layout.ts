import type { Pane, WorkspaceStore } from "@superset/panes";
import type {
	PaneViewerData,
	SessionPaneData,
	TerminalPaneData,
} from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/types";
import {
	resolveSessionName,
	type SessionNameRef,
	type SessionNamesSnapshot,
} from "shared/session-names";
import type { StoreApi } from "zustand/vanilla";
export function paneNameRef(
	pane: Pane<PaneViewerData>,
): SessionNameRef | undefined {
	if (pane.kind === "terminal")
		return {
			provider: "terminal",
			id: (pane.data as TerminalPaneData).terminalId,
		};
	if (pane.kind === "session") {
		const data = pane.data as SessionPaneData;
		return {
			provider: data.provider ?? "claude",
			key: pane.id,
			id: data.forkSession ? undefined : data.resumeSessionId,
		};
	}
}
export function applySessionNames(
	store: StoreApi<WorkspaceStore<PaneViewerData>>,
	snapshot: SessionNamesSnapshot,
	previous?: SessionNamesSnapshot,
) {
	for (const tab of store.getState().tabs) {
		for (const pane of Object.values(tab.panes)) {
			const ref = paneNameRef(pane);
			if (!ref) continue;
			const name = resolveSessionName(snapshot, ref);
			const old = previous && resolveSessionName(previous, ref);
			if (!name && !old) continue;
			// Keep old user-entered pane/group names until the next explicit rename.
			if (
				name?.source === "generated" &&
				pane.titleOverride &&
				pane.titleOverride !== old?.title &&
				pane.titleOverride !== name.title
			)
				continue;
			if (pane.titleOverride !== name?.title)
				store.getState().setPaneTitleOverride({
					tabId: tab.id,
					paneId: pane.id,
					titleOverride: name?.title,
				});
			if (
				Object.keys(tab.panes).length === 1 &&
				tab.titleOverride &&
				(name?.source === "manual" || tab.titleOverride === old?.title)
			)
				store
					.getState()
					.setTabTitleOverride({ tabId: tab.id, titleOverride: undefined });
		}
	}
}
