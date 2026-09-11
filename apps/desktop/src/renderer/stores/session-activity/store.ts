/**
 * A tiny read-only mirror of "what is each Claude session pane doing right
 * now", published by the session store and consumed by the tab/sidebar status
 * dots.
 *
 * Why this module exists at all, rather than the status hook simply importing
 * the session store: the session store lives at the bottom of the workspace
 * route tree (`v2-workspace/$workspaceId/hooks/usePaneRegistry/components/
 * ClaudeSessionPane/sessionStore.ts`) and the status hook lives in
 * `renderer/hooks/host-service`. Reaching upward from a hook into a route's
 * private component folder is the kind of import that quietly turns a leaf into
 * a dependency of everything. So the arrow points the other way: the pane store
 * publishes into this shared, dependency-free store, and anything that wants to
 * know subscribes here.
 *
 * It holds no timeline and no transcript — only the two facts a dot needs.
 */
import type { SessionStatus } from "shared/claude-session/timeline";

export interface SessionActivity {
	/** Mirrors `SessionTimeline.status` for the pane. */
	status: SessionStatus;
	/**
	 * Identifies the turn that most recently finished, so a "seen" mark can be
	 * pinned to one completion instead of to the pane as a whole. Undefined
	 * while the session has never finished a turn.
	 */
	turnKey: string | undefined;
}

const activity = new Map<string, SessionActivity>();
/**
 * pane id → workspace id, registered by the pane itself.
 *
 * Kept beside the activity rather than inside it because the two arrive from
 * different places: the workspace is known at mount, the activity only once
 * the CLI starts talking. Without it the sidebar and dock badges could see a
 * session's status but not which workspace to attribute it to.
 */
const paneWorkspaces = new Map<string, string>();
const listeners = new Set<() => void>();

/**
 * Bumped on every real change. `useSyncExternalStore` compares snapshots by
 * identity, so handing it a number keeps the contract honest — returning the
 * Map itself would either never change identity (missed updates) or have to be
 * cloned on every read (an infinite render loop).
 */
let version = 0;

function notify(): void {
	version++;
	for (const listener of listeners) listener();
}

/**
 * Record a pane's current activity. A no-op when nothing changed, so the
 * per-event call from the session store doesn't re-render every tab on every
 * streamed token.
 */
export function publishSessionActivity(
	paneId: string,
	next: SessionActivity,
): void {
	const prev = activity.get(paneId);
	if (prev && prev.status === next.status && prev.turnKey === next.turnKey) {
		return;
	}
	activity.set(paneId, next);
	notify();
}

/** Note which workspace a session pane belongs to. Idempotent. */
export function registerSessionWorkspace(
	paneId: string,
	workspaceId: string,
): void {
	if (paneWorkspaces.get(paneId) === workspaceId) return;
	paneWorkspaces.set(paneId, workspaceId);
	notify();
}

/** Session pane ids currently registered to a workspace. */
export function getSessionPaneIdsForWorkspace(workspaceId: string): string[] {
	const paneIds: string[] = [];
	for (const [paneId, id] of paneWorkspaces) {
		if (id === workspaceId) paneIds.push(paneId);
	}
	return paneIds;
}

/** Every registered [paneId, workspaceId] pair, for cross-workspace rollups. */
export function getSessionWorkspaceEntries(): Array<[string, string]> {
	return [...paneWorkspaces];
}

/** Drop a pane's activity when its session is disposed. */
export function clearSessionActivity(paneId: string): void {
	const hadActivity = activity.delete(paneId);
	const hadWorkspace = paneWorkspaces.delete(paneId);
	if (!hadActivity && !hadWorkspace) return;
	notify();
}

export function getSessionActivity(
	paneId: string,
): SessionActivity | undefined {
	return activity.get(paneId);
}

export function subscribeSessionActivity(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

export function getSessionActivityVersion(): number {
	return version;
}

/** Test seam — the module-level maps otherwise leak between test cases. */
export function resetSessionActivity(): void {
	activity.clear();
	paneWorkspaces.clear();
	notify();
}
