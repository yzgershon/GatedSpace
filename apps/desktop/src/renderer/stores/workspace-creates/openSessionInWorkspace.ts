/**
 * Open a recent session as a pane inside a workspace, from outside its route.
 *
 * Same mechanism as `openSessionsPaneInWorkspace`: the sidebar rail sits above
 * the workspace routes and can't reach a workspace's live pane store, but the
 * layout is persisted — appending a tab to the stored layout and navigating
 * there gets the pane mounted inside the workspace tree.
 *
 * The resume/fork decision is made BEFORE this is called, by the panel, which
 * is the only place that can see both the host's terminal bindings and the
 * desktop's own pane sessions. This function just carries it.
 */
import { createWorkspaceStore, type WorkspaceState } from "@superset/panes";
import type {
	PaneViewerData,
	SessionPaneData,
} from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/types";
import type { AppCollections } from "renderer/routes/_authenticated/providers/CollectionsProvider/collections";

const EMPTY_STATE: WorkspaceState<PaneViewerData> = {
	version: 1,
	tabs: [],
	activeTabId: null,
};

export interface OpenSessionRequest {
	sessionId: string;
	/** The session's own project directory, which may not be this worktree. */
	cwd: string | null;
	title: string;
	/** Fork opens a copy under a fresh id rather than writing to this one. */
	fork: boolean;
}

/**
 * Append a session tab to a workspace's stored layout. Returns false when the
 * workspace has no stored state yet, which means it has never been opened and
 * there's nothing to append to.
 */
export function openSessionInWorkspace(
	collections: AppCollections,
	workspaceId: string,
	request: OpenSessionRequest,
): boolean {
	const existing = collections.v2WorkspaceLocalState.get(workspaceId);
	if (!existing) return false;

	const current =
		(existing.paneLayout as WorkspaceState<PaneViewerData> | undefined) ??
		EMPTY_STATE;

	const store = createWorkspaceStore<PaneViewerData>({ initialState: current });
	store.getState().addTab({
		titleOverride: request.title,
		panes: [
			{
				kind: "session",
				data: {
					resumeSessionId: request.sessionId,
					forkSession: request.fork,
					// The session's own directory wins: resuming it against this
					// workspace's worktree would continue the conversation over the
					// wrong tree.
					...(request.cwd ? { cwd: request.cwd } : {}),
				} as SessionPaneData as PaneViewerData,
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
