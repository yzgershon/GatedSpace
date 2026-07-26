/**
 * Open the recent-sessions list in a workspace from outside its route.
 *
 * The sidebar rail lives above the workspace routes, so it can't reach a
 * workspace's live pane store. It doesn't need to: the layout is persisted, so
 * appending a tab to the stored layout and navigating there gets the pane
 * mounted inside the workspace tree.
 *
 * That placement is the point. The sessions list decides whether a session can
 * be plain-resumed by checking the host's terminal bindings, which are only
 * reachable in workspace context. A standalone dialog in the rail would lose
 * that check and could offer a plain resume for a session a terminal is
 * holding — two writers on one session id, which destroys the newer transcript.
 */
import { createWorkspaceStore, type WorkspaceState } from "@superset/panes";
import type { PaneViewerData } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/types";
import type { AppCollections } from "renderer/routes/_authenticated/providers/CollectionsProvider/collections";

const EMPTY_STATE: WorkspaceState<PaneViewerData> = {
	version: 1,
	tabs: [],
	activeTabId: null,
};

/** The sessions list is read-only, so one is always enough. */
function findExistingSessionsTab(
	state: WorkspaceState<PaneViewerData>,
): string | null {
	for (const tab of state.tabs) {
		const panes = Object.values(tab.panes ?? {});
		if (panes.some((pane) => pane?.kind === "claude-sessions")) return tab.id;
	}
	return null;
}

/**
 * Ensure the workspace has a recent-sessions tab and make it active. Returns
 * false when there's no stored state for the workspace yet, which means it
 * hasn't been opened and there's nothing to append to.
 */
export function openSessionsPaneInWorkspace(
	collections: AppCollections,
	workspaceId: string,
): boolean {
	const existing = collections.v2WorkspaceLocalState.get(workspaceId);
	if (!existing) return false;

	const current =
		(existing.paneLayout as WorkspaceState<PaneViewerData> | undefined) ??
		EMPTY_STATE;

	// Already open: just focus it rather than stacking duplicates.
	const existingTabId = findExistingSessionsTab(current);
	if (existingTabId) {
		collections.v2WorkspaceLocalState.update(workspaceId, (draft) => {
			draft.paneLayout = { ...current, activeTabId: existingTabId };
		});
		return true;
	}

	const store = createWorkspaceStore<PaneViewerData>({
		initialState: current,
	});
	store.getState().addTab({
		titleOverride: "Sessions",
		panes: [{ kind: "claude-sessions", data: {} as PaneViewerData }],
	});
	const next = store.getState();
	collections.v2WorkspaceLocalState.update(workspaceId, (draft) => {
		draft.paneLayout = {
			version: next.version,
			tabs: next.tabs,
			activeTabId: next.activeTabId,
		};
	});
	return true;
}
