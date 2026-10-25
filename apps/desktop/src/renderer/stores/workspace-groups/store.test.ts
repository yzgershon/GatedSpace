import { beforeEach, describe, expect, it } from "bun:test";
import {
	clearWorkspaceGroups,
	getWorkspaceGroups,
	getWorkspaceGroupsVersion,
	publishWorkspaceGroups,
	resetWorkspaceGroups,
	subscribeWorkspaceGroups,
	type WorkspaceGroup,
} from "./store";

function group(overrides: Partial<WorkspaceGroup> = {}): WorkspaceGroup {
	return {
		id: "tab-1",
		title: "GatedSpace Edits",
		paneIds: ["pane-1"],
		sessions: [{ paneId: "pane-1", provider: "claude" }],
		isActive: true,
		...overrides,
	};
}

describe("workspace-groups", () => {
	beforeEach(() => {
		resetWorkspaceGroups();
	});

	it("keeps groups per workspace", () => {
		publishWorkspaceGroups("ws-a", [group()]);
		publishWorkspaceGroups("ws-b", [group({ id: "tab-9", title: "Sortie" })]);

		expect(getWorkspaceGroups("ws-a").map((g) => g.title)).toEqual([
			"GatedSpace Edits",
		]);
		expect(getWorkspaceGroups("ws-b").map((g) => g.title)).toEqual(["Sortie"]);
		expect(getWorkspaceGroups("ws-never-opened")).toEqual([]);
	});

	/*
	 * The page publishes on EVERY pane-store change, which during a streaming
	 * turn is many times a second. Without this the sidebar would re-render on
	 * each one for a tree that did not move.
	 */
	it("does not notify when nothing moved", () => {
		let notifications = 0;
		const unsubscribe = subscribeWorkspaceGroups(() => {
			notifications++;
		});

		publishWorkspaceGroups("ws-a", [group()]);
		publishWorkspaceGroups("ws-a", [group()]);
		expect(notifications).toBe(1);

		publishWorkspaceGroups("ws-a", [group({ title: "Renamed" })]);
		expect(notifications).toBe(2);

		unsubscribe();
	});

	it("notices a pane moving between groups", () => {
		publishWorkspaceGroups("ws-a", [group({ paneIds: ["pane-1", "pane-2"] })]);
		const before = getWorkspaceGroupsVersion();
		publishWorkspaceGroups("ws-a", [
			group({ paneIds: ["pane-1"] }),
			group({ id: "tab-2", title: "Tab 2", paneIds: ["pane-2"] }),
		]);
		expect(getWorkspaceGroupsVersion()).toBeGreaterThan(before);
		expect(getWorkspaceGroups("ws-a")).toHaveLength(2);
	});

	it("updates a session's provider and name without needing a group title change", () => {
		let notifications = 0;
		const unsubscribe = subscribeWorkspaceGroups(() => notifications++);
		publishWorkspaceGroups("ws-a", [group()]);
		const codex = group({
			sessions: [{ paneId: "pane-1", provider: "codex" }],
		});
		publishWorkspaceGroups("ws-a", [codex]);
		expect(getWorkspaceGroups("ws-a")[0].sessions[0].provider).toBe("codex");
		expect(notifications).toBe(2);

		const renamed = group({
			sessions: [
				{ paneId: "pane-1", provider: "codex", title: "Review sign-in" },
			],
		});
		publishWorkspaceGroups("ws-a", [renamed]);
		expect(getWorkspaceGroups("ws-a")[0].sessions[0].title).toBe(
			"Review sign-in",
		);
		expect(notifications).toBe(3);
		publishWorkspaceGroups("ws-a", [structuredClone(renamed)]);
		expect(notifications).toBe(3);

		publishWorkspaceGroups("ws-a", [group({ sessions: [] })]);
		expect(getWorkspaceGroups("ws-a")[0].sessions).toEqual([]);
		expect(notifications).toBe(4);
		unsubscribe();
	});

	/*
	 * A workspace whose route unmounted has no live pane store, so its rows
	 * would offer to focus panes that no longer exist.
	 */
	it("goes quiet when the workspace closes", () => {
		publishWorkspaceGroups("ws-a", [group()]);
		clearWorkspaceGroups("ws-a");
		expect(getWorkspaceGroups("ws-a")).toEqual([]);
	});

	it("does not notify when clearing a workspace it never had", () => {
		let notifications = 0;
		const unsubscribe = subscribeWorkspaceGroups(() => {
			notifications++;
		});
		clearWorkspaceGroups("ws-never-opened");
		expect(notifications).toBe(0);
		unsubscribe();
	});
});
