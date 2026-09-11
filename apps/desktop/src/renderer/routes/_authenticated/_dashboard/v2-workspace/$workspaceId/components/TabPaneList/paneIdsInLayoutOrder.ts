import type { LayoutNode, Tab } from "@superset/panes";

/**
 * A tab's pane ids in the order they appear on screen, left to right and top
 * to bottom.
 *
 * `tab.panes` is a record keyed by id, so iterating it yields insertion order —
 * which stops matching the screen as soon as a pane is moved, or one is closed
 * and another added. The hover card numbers its rows, and a numbered list whose
 * order disagrees with the layout is worse than one with no numbers at all.
 */
export function paneIdsInLayoutOrder<TData>(tab: Tab<TData>): string[] {
	const ordered: string[] = [];
	// Deduped as we walk. A pane id appearing twice in the tree is a bug, but
	// the rows are keyed by pane id, so emitting it twice would turn that bug
	// into a React key collision — a louder, less informative failure.
	const seen = new Set<string>();
	const push = (paneId: string): void => {
		// A tree entry with no pane behind it must not become an empty row.
		if (seen.has(paneId) || tab.panes[paneId] === undefined) return;
		seen.add(paneId);
		ordered.push(paneId);
	};
	const visit = (node: LayoutNode | undefined): void => {
		if (!node) return;
		if (node.type === "pane") {
			push(node.paneId);
			return;
		}
		visit(node.first);
		visit(node.second);
	};
	visit(tab.layout);

	// A pane present in `panes` but missing from the tree is a bug elsewhere.
	// Listed anyway, at the end: dropping it would hide both the pane and the
	// bug, and the count on the tab badge would then disagree with this list.
	for (const paneId of Object.keys(tab.panes)) push(paneId);
	return ordered;
}
