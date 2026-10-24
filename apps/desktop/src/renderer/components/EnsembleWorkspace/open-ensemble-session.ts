import { createWorkspaceStore, type WorkspaceState } from "@superset/panes";
import type { PaneViewerData } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/types";
import type { AppCollections } from "renderer/routes/_authenticated/providers/CollectionsProvider/collections";
import type { EnsembleMember } from "../../../shared/ensemble";

/** Focus the original pane. Dedicated sessions use their existing native key, never a second resume. */
export function openEnsembleSession(
	collections: AppCollections,
	member: EnsembleMember,
): string {
	for (const row of collections.v2WorkspaceLocalState.values()) {
		const layout = row.paneLayout as WorkspaceState<PaneViewerData> | undefined;
		if (!layout) continue;
		const tab = layout.tabs.find((t) =>
			Object.values(t.panes).some((p) => p.id === member.key),
		);
		if (!tab) continue;
		const store = createWorkspaceStore<PaneViewerData>({
			initialState: layout,
		});
		store.getState().setActiveTab(tab.id);
		store.getState().setActivePane({ tabId: tab.id, paneId: member.key });
		const next = store.getState();
		collections.v2WorkspaceLocalState.update(row.workspaceId, (draft) => {
			draft.paneLayout = {
				version: next.version,
				tabs: next.tabs,
				activeTabId: next.activeTabId,
			};
		});
		return row.workspaceId;
	}
	if (!member.workspaceId)
		throw new Error(
			"Open this session's workspace first, then select its existing conversation.",
		);
	const row = collections.v2WorkspaceLocalState.get(member.workspaceId);
	if (!row)
		throw new Error(
			"Open this workspace once before adding its dedicated session pane.",
		);
	const store = createWorkspaceStore<PaneViewerData>({
		initialState: (row.paneLayout as
			| WorkspaceState<PaneViewerData>
			| undefined) ?? { version: 1, tabs: [], activeTabId: null },
	});
	store.getState().addTab({
		titleOverride: member.title,
		panes: [
			{
				id: member.key,
				kind: "session",
				data: {
					provider: member.provider,
					cwd: member.cwd,
					...(member.conversationId
						? { resumeSessionId: member.conversationId }
						: {}),
				},
			},
		],
	});
	const next = store.getState();
	collections.v2WorkspaceLocalState.update(member.workspaceId, (draft) => {
		draft.paneLayout = {
			version: next.version,
			tabs: next.tabs,
			activeTabId: next.activeTabId,
		};
	});
	return member.workspaceId;
}
