/**
 * Open a terminal as a pane inside a workspace, from outside its route.
 *
 * Same mechanism and same reason as `openSessionInWorkspace`: the sidebar rail
 * sits above the workspace routes and cannot reach a workspace's live pane
 * store, but the layout is persisted, so appending a tab to the stored layout
 * and navigating there gets the pane mounted inside the workspace tree.
 *
 * THE SESSION MUST ALREADY EXIST ON host-service BEFORE THIS IS CALLED. The
 * pane opens a WebSocket against the terminal id as soon as it mounts, and a
 * socket that arrives before the session does gets an error the pane renders as
 * a dead terminal. The launcher inside a workspace has the same rule.
 */
import { createWorkspaceStore, type WorkspaceState } from "@superset/panes";
import type {
	PaneViewerData,
	TerminalPaneData,
} from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/types";
import type { AppCollections } from "renderer/routes/_authenticated/providers/CollectionsProvider/collections";

const EMPTY_STATE: WorkspaceState<PaneViewerData> = {
	version: 1,
	tabs: [],
	activeTabId: null,
};

export interface OpenTerminalRequest {
	terminalId: string;
	/** Tab label. The terminal's own title takes over once the shell reports one. */
	title?: string;
	/**
	 * Which agent this terminal was launched to run, for the pane accent. A
	 * resumed Claude or Codex session is exactly that, so it gets the colour.
	 */
	agentId?: string;
}

/**
 * Append a terminal tab to a workspace's stored layout. Returns false when the
 * workspace has no stored state yet, which means it has never been opened and
 * there is nothing to append to.
 */
export function openTerminalInWorkspace(
	collections: AppCollections,
	workspaceId: string,
	request: OpenTerminalRequest,
): boolean {
	const existing = collections.v2WorkspaceLocalState.get(workspaceId);
	if (!existing) return false;

	const current =
		(existing.paneLayout as WorkspaceState<PaneViewerData> | undefined) ??
		EMPTY_STATE;

	const store = createWorkspaceStore<PaneViewerData>({ initialState: current });
	store.getState().addTab({
		...(request.title ? { titleOverride: request.title } : {}),
		panes: [
			{
				kind: "terminal",
				data: {
					terminalId: request.terminalId,
					...(request.agentId ? { agentId: request.agentId } : {}),
				} as TerminalPaneData as PaneViewerData,
			},
		],
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
