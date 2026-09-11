import { describe, expect, it } from "bun:test";
import type { LayoutNode, Pane, Tab } from "@superset/panes";
import { paneIdsInLayoutOrder } from "./paneIdsInLayoutOrder";

function pane(id: string): Pane<unknown> {
	return { id, kind: "terminal", data: {} };
}

function tab(layout: LayoutNode, paneIds: string[]): Tab<unknown> {
	return {
		id: "tab-1",
		createdAt: 0,
		activePaneId: paneIds[0] ?? null,
		layout,
		panes: Object.fromEntries(paneIds.map((id) => [id, pane(id)])),
	};
}

const leaf = (paneId: string): LayoutNode => ({ type: "pane", paneId });
const split = (first: LayoutNode, second: LayoutNode): LayoutNode => ({
	type: "split",
	direction: "horizontal",
	first,
	second,
});

describe("paneIdsInLayoutOrder", () => {
	it("returns the single pane of an unsplit tab", () => {
		expect(paneIdsInLayoutOrder(tab(leaf("a"), ["a"]))).toEqual(["a"]);
	});

	it("walks a split first-then-second", () => {
		expect(
			paneIdsInLayoutOrder(tab(split(leaf("a"), leaf("b")), ["a", "b"])),
		).toEqual(["a", "b"]);
	});

	it("walks a nested split depth-first", () => {
		const layout = split(leaf("a"), split(leaf("b"), leaf("c")));
		expect(paneIdsInLayoutOrder(tab(layout, ["a", "b", "c"]))).toEqual([
			"a",
			"b",
			"c",
		]);
	});

	/**
	 * The reason this function exists rather than `Object.keys(tab.panes)`:
	 * the record keeps insertion order, which stops matching the screen the
	 * moment a pane is moved.
	 */
	it("follows the layout, not the insertion order of tab.panes", () => {
		const layout = split(leaf("b"), leaf("a"));
		const withReversedRecord: Tab<unknown> = {
			...tab(layout, ["a", "b"]),
			panes: { a: pane("a"), b: pane("b") },
		};
		expect(paneIdsInLayoutOrder(withReversedRecord)).toEqual(["b", "a"]);
	});

	it("still lists a pane the layout tree forgot, at the end", () => {
		const orphaned = tab(leaf("a"), ["a", "stray"]);
		expect(paneIdsInLayoutOrder(orphaned)).toEqual(["a", "stray"]);
	});

	/** A tree entry with no pane behind it must not become an empty row. */
	it("drops a layout entry with no matching pane", () => {
		const stale = tab(split(leaf("a"), leaf("gone")), ["a"]);
		expect(paneIdsInLayoutOrder(stale)).toEqual(["a"]);
	});

	/**
	 * Rows are keyed by pane id, so a duplicate would trade a layout bug for a
	 * React key collision.
	 */
	it("never repeats a pane listed twice in the tree", () => {
		const duplicated = tab(split(leaf("a"), leaf("a")), ["a"]);
		expect(paneIdsInLayoutOrder(duplicated)).toEqual(["a"]);
	});
});
