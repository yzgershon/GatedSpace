/**
 * How many panes a workspace has open, for the sidebar badge.
 *
 * This was previously written off as blocked on data availability: the reasoning
 * was that `stores/tabs` only holds panes for the ACTIVE workspace, so a badge
 * would appear on one row and be absent from the rest — worse than no badge.
 *
 * That was true of the wrong source. `v2WorkspaceLocalState` persists a
 * `paneLayout` for EVERY workspace, and the sidebar already loads every row to
 * order them across projects. The count is therefore available for all rows
 * from data that is already in memory, with no extra read.
 *
 * Kept as a pure function over the stored shape so it can be tested without a
 * collection, a provider or a workspace.
 */

/** The parts of the persisted pane layout this needs. Deliberately loose. */
export interface CountablePaneLayout {
	tabs?: Array<{ panes?: Record<string, unknown> | null } | null> | null;
}

/**
 * Counts panes across every tab.
 *
 * Tabs are counted TOGETHER rather than per-tab: the question the badge answers
 * is "how much is going on in this workspace", and a workspace with three tabs
 * of one pane each is doing as much as one tab with three.
 *
 * Tolerant of partial rows on purpose. This reads persisted state that has been
 * through schema migrations and a read-heal path, and a badge is never worth
 * throwing in a sidebar render.
 */
export function countWorkspacePanes(
	paneLayout: CountablePaneLayout | null | undefined,
): number {
	const tabs = paneLayout?.tabs;
	if (!Array.isArray(tabs)) return 0;

	let total = 0;
	for (const tab of tabs) {
		const panes = tab?.panes;
		if (!panes || typeof panes !== "object") continue;
		total += Object.keys(panes).length;
	}
	return total;
}

/**
 * Whether a count is worth showing.
 *
 * One pane is the default state of every workspace, so badging it would put a
 * "1" on nearly every row and teach people to ignore the badge. Zero means
 * nothing is open, which the row already conveys by not being active.
 */
export function shouldShowPaneCount(count: number): boolean {
	return count > 1;
}
