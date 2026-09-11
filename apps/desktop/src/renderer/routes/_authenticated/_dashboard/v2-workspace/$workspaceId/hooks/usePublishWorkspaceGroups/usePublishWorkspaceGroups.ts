/**
 * Mirrors this workspace's groups into the shared `workspace-groups` store, so
 * the sidebar can nest sessions under the group they are in.
 *
 * The publish happens HERE rather than in the sidebar because everything it
 * needs is here and nowhere else: the pane store is created per route by
 * `useV2WorkspacePaneLayout` (calling that hook from the sidebar builds a
 * second, empty one), and resolving a group's title needs the pane registry,
 * which is built in this route with the openers wired into it.
 *
 * Publishing on every store change is safe because `publishWorkspaceGroups`
 * compares structurally and returns early when nothing moved — a streamed
 * token changes a pane's contents, not its id, its title or its group.
 */
import type { PaneRegistry, WorkspaceStore } from "@superset/panes";
import { resolveTabTitle } from "@superset/panes";
import { useEffect } from "react";
import {
	clearWorkspaceGroups,
	publishWorkspaceGroups,
	type WorkspaceGroup,
} from "renderer/stores/workspace-groups";
import type { StoreApi } from "zustand/vanilla";
import { paneIdsInLayoutOrder } from "../../components/TabPaneList";
import type { PaneViewerData } from "../../types";

export function usePublishWorkspaceGroups({
	workspaceId,
	store,
	registry,
}: {
	workspaceId: string;
	store: StoreApi<WorkspaceStore<PaneViewerData>>;
	registry: PaneRegistry<PaneViewerData>;
}): void {
	useEffect(() => {
		const publish = () => {
			const { tabs, activeTabId } = store.getState();
			const groups: WorkspaceGroup[] = tabs.map((tab) => ({
				id: tab.id,
				title: resolveTabTitle(tab, tabs, registry),
				paneIds: paneIdsInLayoutOrder(tab),
				isActive: tab.id === activeTabId,
			}));
			publishWorkspaceGroups(workspaceId, groups);
		};

		publish();
		const unsubscribe = store.subscribe(publish);
		return () => {
			unsubscribe();
			/*
			 * Cleared on unmount, not left behind. A workspace with no mounted
			 * pane store has no live groups, and stale rows in the sidebar would
			 * offer to focus panes that no longer exist.
			 */
			clearWorkspaceGroups(workspaceId);
		};
	}, [workspaceId, store, registry]);
}
