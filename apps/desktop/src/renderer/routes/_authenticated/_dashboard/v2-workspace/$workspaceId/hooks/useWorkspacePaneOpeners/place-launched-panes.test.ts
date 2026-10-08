import { describe, expect, it } from "bun:test";
import { type CreatePaneInput, createWorkspaceStore } from "@superset/panes";
import type { PaneViewerData } from "../../types";
import { placeLaunchedPanes } from "./place-launched-panes";

function setup() {
	const store = createWorkspaceStore<PaneViewerData>();
	store.getState().addTab({
		id: "group",
		panes: [{ id: "existing", kind: "session", data: {} }],
	});
	store.getState().splitPane({
		tabId: "group",
		paneId: "existing",
		position: "right",
		newPane: { id: "chooser", kind: "new-tab", data: {} },
	});
	store
		.getState()
		.resizeSplit({ tabId: "group", path: [], splitPercentage: 62 });
	return store;
}

describe("chooser launch placement", () => {
	for (const provider of ["claude", "codex", "terminal"] as const) {
		it(`keeps ${provider} in the chosen split and preserves its sibling`, () => {
			const store = setup();
			const sibling = store.getState().getPane("existing")?.pane;
			const pane: CreatePaneInput<PaneViewerData> =
				provider === "terminal"
					? { id: "agent", kind: "terminal", data: { terminalId: "term" } }
					: { id: "agent", kind: "session", data: { provider } };
			placeLaunchedPanes(store, [pane], { tabId: "group", paneId: "chooser" });
			expect(store.getState().tabs).toHaveLength(1);
			expect(store.getState().getPane("chooser")).toBeNull();
			expect(store.getState().getPane("existing")?.pane).toBe(sibling);
			expect(store.getState().getTab("group")?.layout).toEqual({
				type: "split",
				direction: "horizontal",
				first: { type: "pane", paneId: "existing" },
				second: { type: "pane", paneId: "agent" },
				splitPercentage: 62,
			});
		});
	}
	it("retains the source group when focus changes during terminal creation", () => {
		const store = setup();
		store.getState().addTab({
			id: "other",
			panes: [{ id: "other-pane", kind: "session", data: {} }],
		});
		placeLaunchedPanes(
			store,
			[{ id: "agent", kind: "terminal", data: { terminalId: "term" } }],
			{ tabId: "group", paneId: "chooser" },
		);
		expect(store.getState().activeTabId).toBe("other");
		expect(store.getState().getPane("agent")?.tabId).toBe("group");
		expect(Object.keys(store.getState().getTab("other")?.panes ?? {})).toEqual([
			"other-pane",
		]);
	});
	it("keeps expansion on the replacement pane", () => {
		const store = setup();
		store.getState().toggleMaximizePane({ tabId: "group", paneId: "chooser" });
		placeLaunchedPanes(
			store,
			[{ id: "agent", kind: "session", data: { provider: "codex" } }],
			{ tabId: "group", paneId: "chooser" },
		);
		expect(store.getState().getTab("group")?.maximizedPaneId).toBe("agent");
	});
	it("opens additional commands in the same group without replacing an existing session", () => {
		const store = setup();
		const target = { tabId: "group", paneId: "chooser" };
		placeLaunchedPanes(
			store,
			[
				{ id: "one", kind: "session", data: {} },
				{ id: "two", kind: "session", data: {} },
			],
			target,
		);
		placeLaunchedPanes(
			store,
			[{ id: "three", kind: "session", data: {} }],
			target,
		);
		expect(store.getState().tabs).toHaveLength(1);
		expect(Object.keys(store.getState().getTab("group")?.panes ?? {})).toEqual([
			"existing",
			"one",
			"two",
			"three",
		]);
	});
});
