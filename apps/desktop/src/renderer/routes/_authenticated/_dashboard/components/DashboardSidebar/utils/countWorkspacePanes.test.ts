import { describe, expect, it } from "bun:test";
import {
	countWorkspacePanes,
	shouldShowPaneCount,
} from "./countWorkspacePanes";

describe("countWorkspacePanes", () => {
	it("sums panes across every tab", () => {
		// Three tabs of one pane is as busy as one tab of three, so tabs are not
		// counted separately.
		expect(
			countWorkspacePanes({
				tabs: [
					{ panes: { a: {}, b: {} } },
					{ panes: { c: {} } },
					{ panes: { d: {}, e: {}, f: {} } },
				],
			}),
		).toBe(6);
	});

	it("counts a single-pane workspace as one", () => {
		expect(countWorkspacePanes({ tabs: [{ panes: { a: {} } }] })).toBe(1);
	});

	it("returns zero for an empty layout", () => {
		expect(countWorkspacePanes({ tabs: [] })).toBe(0);
	});

	it("survives the partial rows persistence can hand back", () => {
		// This reads state that has been through schema migrations and a
		// read-heal path. A sidebar render must not throw over a badge.
		expect(countWorkspacePanes(null)).toBe(0);
		expect(countWorkspacePanes(undefined)).toBe(0);
		expect(countWorkspacePanes({})).toBe(0);
		expect(countWorkspacePanes({ tabs: null })).toBe(0);
		expect(countWorkspacePanes({ tabs: [null] })).toBe(0);
		expect(countWorkspacePanes({ tabs: [{ panes: null }] })).toBe(0);
		expect(countWorkspacePanes({ tabs: [{}] })).toBe(0);
	});

	it("ignores a tab whose panes is not an object", () => {
		expect(
			countWorkspacePanes({
				tabs: [
					{ panes: "corrupt" as unknown as Record<string, unknown> },
					{ panes: { a: {} } },
				],
			}),
		).toBe(1);
	});

	it("is not fooled by a non-array tabs value", () => {
		expect(
			countWorkspacePanes({
				tabs: { length: 3 } as unknown as [],
			}),
		).toBe(0);
	});
});

describe("shouldShowPaneCount", () => {
	it("hides the badge for one pane", () => {
		// One pane is the default state of every workspace. Badging it would put
		// a "1" on nearly every row and train people to ignore the badge.
		expect(shouldShowPaneCount(1)).toBe(false);
	});

	it("hides the badge for zero", () => {
		expect(shouldShowPaneCount(0)).toBe(false);
	});

	it("shows the badge once there is more than one", () => {
		expect(shouldShowPaneCount(2)).toBe(true);
		expect(shouldShowPaneCount(11)).toBe(true);
	});
});
