import type { WorkspaceState } from "@superset/panes";
import type {
	PaneViewerData,
	SessionPaneData,
	TerminalPaneData,
} from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/types";
import type { AppCollections } from "renderer/routes/_authenticated/providers/CollectionsProvider/collections";

export function findSessionPane(
	layout: WorkspaceState<PaneViewerData>,
	request: {
		provider: "claude" | "codex";
		sessionId: string;
		terminalId?: string;
	},
) {
	for (const tab of layout.tabs) {
		for (const pane of Object.values(tab.panes)) {
			const data = pane.data as SessionPaneData;
			const native =
				pane.kind === "session" &&
				(data.provider ?? "claude") === request.provider &&
				!data.forkSession &&
				data.resumeSessionId === request.sessionId;
			const terminal =
				request.terminalId &&
				pane.kind === "terminal" &&
				(pane.data as TerminalPaneData).terminalId === request.terminalId;
			if (native || terminal) return { tabId: tab.id, paneId: pane.id };
		}
	}
	return null;
}

/** Focus the persisted original in any workspace, without starting another writer. */
export function focusExistingSession(
	collections: AppCollections,
	request: Parameters<typeof findSessionPane>[1],
	preferredWorkspaceId?: string,
): string | null {
	const rows = [...collections.v2WorkspaceLocalState.state.values()].sort(
		(a, b) =>
			Number(b.workspaceId === preferredWorkspaceId) -
			Number(a.workspaceId === preferredWorkspaceId),
	);
	for (const row of rows) {
		const layout = row.paneLayout as WorkspaceState<PaneViewerData> | undefined;
		if (!layout?.tabs) continue;
		const match = findSessionPane(layout, request);
		if (!match) continue;
		collections.v2WorkspaceLocalState.update(row.workspaceId, (draft) => {
			draft.paneLayout = {
				...layout,
				activeTabId: match.tabId,
				tabs: layout.tabs.map((tab) =>
					tab.id !== match.tabId
						? tab
						: {
								...tab,
								activePaneId: match.paneId,
								// A different maximized pane must not hide the selected session.
								maximizedPaneId: tab.maximizedPaneId ? match.paneId : null,
							},
				),
			};
		});
		return row.workspaceId;
	}
	return null;
}
