/**
 * A read-only mirror of "which groups does the open workspace have, and which
 * panes are in each", published by the workspace page and consumed by the
 * sidebar.
 *
 * Same shape and same reason as `session-activity`, which the file next door
 * documents at length: the v2 pane store is created PER ROUTE by
 * `useV2WorkspacePaneLayout`, so a sidebar that called that hook would build a
 * SECOND, empty store rather than read the live one. The arrow has to point
 * outward — the page publishes, anything that wants to know subscribes here.
 *
 * The TITLE has to come through this store rather than being derived by the
 * reader: resolving a group's title needs the pane registry (a group with no
 * override is named after its title pane, via that pane kind's `getTitle`), and
 * the registry is built inside the workspace route with the openers wired into
 * it. The sidebar has no business reaching for either.
 *
 * Only the workspace you are IN publishes, by construction — nothing else has
 * a mounted pane store. That is the same honest emptiness `session-activity`
 * has: a workspace you have not opened has no groups to list, and inventing
 * rows for it would print a column of "Tab 1".
 */
export interface WorkspaceGroup {
	/** The tab id. `setActiveTab` takes this. */
	id: string;
	title: string;
	/** In layout order, deduped — the order the panes appear on screen. */
	paneIds: string[];
	isActive: boolean;
}

const groupsByWorkspace = new Map<string, WorkspaceGroup[]>();
const listeners = new Set<() => void>();

/**
 * Bumped on every real change. `useSyncExternalStore` compares snapshots by
 * identity, so handing it a number keeps the contract honest — returning the
 * array itself would either never change identity (missed updates) or have to
 * be rebuilt on every read (an infinite render loop).
 */
let version = 0;

function notify(): void {
	version++;
	for (const listener of listeners) listener();
}

/** Cheap structural compare, so a re-render that changed nothing is a no-op. */
function isSame(a: WorkspaceGroup[], b: WorkspaceGroup[]): boolean {
	if (a.length !== b.length) return false;
	return a.every((group, index) => {
		const other = b[index];
		return (
			other !== undefined &&
			group.id === other.id &&
			group.title === other.title &&
			group.isActive === other.isActive &&
			group.paneIds.length === other.paneIds.length &&
			group.paneIds.every((paneId, i) => paneId === other.paneIds[i])
		);
	});
}

/**
 * Publish a workspace's groups. Called on every store change from the page, so
 * it must stay cheap and must not notify when nothing moved — otherwise every
 * streamed token would re-render the sidebar.
 */
export function publishWorkspaceGroups(
	workspaceId: string,
	groups: WorkspaceGroup[],
): void {
	const previous = groupsByWorkspace.get(workspaceId);
	if (previous && isSame(previous, groups)) return;
	groupsByWorkspace.set(workspaceId, groups);
	notify();
}

/** Called when the workspace route unmounts, so a closed workspace goes quiet. */
export function clearWorkspaceGroups(workspaceId: string): void {
	if (!groupsByWorkspace.delete(workspaceId)) return;
	notify();
}

export function getWorkspaceGroups(workspaceId: string): WorkspaceGroup[] {
	return groupsByWorkspace.get(workspaceId) ?? [];
}

export function subscribeWorkspaceGroups(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

export function getWorkspaceGroupsVersion(): number {
	return version;
}

/** Test seam — the module-level map otherwise leaks between test cases. */
export function resetWorkspaceGroups(): void {
	groupsByWorkspace.clear();
	notify();
}
