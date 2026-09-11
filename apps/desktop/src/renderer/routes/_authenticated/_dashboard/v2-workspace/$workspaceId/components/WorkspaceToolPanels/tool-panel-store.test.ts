import { describe, expect, test } from "bun:test";
import {
	createToolPanels,
	mainPaneMinimum,
	panelButtonOwner,
} from "./tool-panel-store";

function setup(saved?: string) {
	const values = new Map<string, string>(saved ? [["test", saved]] : []);
	const storage = {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => {
			values.set(key, value);
		},
	};
	const tools = createToolPanels({
		key: "test",
		storage,
		createTerminal: async () => "terminal-1",
	});
	const disconnect = tools.connect();
	return { tools, disconnect, storage, values };
}

describe("workspace tool panels", () => {
	test("empty right panel toggles and restores without creating any tool", async () => {
		const { tools, disconnect, storage } = setup();
		await tools.toggle("right");
		expect(tools.state.getState().right).toMatchObject({
			open: true,
			activeTabId: null,
		});
		expect(tools.state.getState().focus).toBe("right");
		await tools.toggle("right");
		await tools.toggle("right");
		expect(tools.store.getState().tabs).toHaveLength(0);
		disconnect();
		const restored = createToolPanels({
			key: "test",
			storage,
			createTerminal: async () => {
				throw new Error("Opening the chooser must not start a shell");
			},
		});
		expect(restored.state.getState().right.open).toBe(true);
		expect(restored.state.getState().right.activeTabId).toBeNull();
		expect(restored.store.getState().tabs).toHaveLength(0);
	});
	test("right panel reopens its selected tool and returns to the chooser after closing the last tab", async () => {
		const { tools, disconnect } = setup();
		await tools.open("right", "session");
		const tab = tools.store.getState().tabs[0];
		await tools.toggle("right");
		await tools.toggle("right");
		expect(tools.store.getState().tabs).toEqual([tab]);
		expect(tools.state.getState().right.activeTabId).toBe(tab.id);
		tools.store.getState().removeTab(tab.id);
		expect(tools.state.getState().right.activeTabId).toBeNull();
		await tools.toggle("right");
		await tools.toggle("right");
		expect(tools.state.getState().right.open).toBe(true);
		expect(tools.store.getState().tabs).toHaveLength(0);
		disconnect();
	});
	test("tool panels leave room for both horizontal and vertical pane minimums", () => {
		const pane = { type: "pane", paneId: "a" } as const;
		expect(
			mainPaneMinimum(
				{ type: "split", direction: "horizontal", first: pane, second: pane },
				9,
			),
		).toEqual({ width: 575, height: 260 });
		expect(
			mainPaneMinimum(
				{ type: "split", direction: "vertical", first: pane, second: pane },
				9,
			),
		).toEqual({ width: 400, height: 375 });
	});
	test("closing the last right tab does not reveal a hidden bottom panel", async () => {
		const { tools, disconnect } = setup();
		const right = tools.add("right", {
			kind: "browser",
			data: { url: "about:blank" },
		});
		await tools.open("bottom", "terminal");
		tools.select(right);
		tools.setOpen("bottom", false);
		tools.store.getState().removeTab(right);
		expect(tools.state.getState().bottom.open).toBe(false);
		expect(tools.state.getState().focus).toBe("right");
		expect(tools.state.getState().right.activeTabId).toBeNull();
		disconnect();
	});
	test("hiding retains terminal identity, data and order; reopening does not create a new shell", async () => {
		const { tools, disconnect } = setup();
		await tools.toggle("bottom");
		const tab = tools.store.getState().tabs[0];
		await tools.toggle("bottom");
		expect(tools.state.getState().bottom.open).toBe(false);
		expect(tools.store.getState().tabs[0]).toBe(tab);
		await tools.toggle("bottom");
		expect(tools.store.getState().tabs).toHaveLength(1);
		expect(tools.store.getState().tabs[0]).toBe(tab);
		disconnect();
	});
	test("moving and reordering tabs retain pane identities and repair the source selection", () => {
		const { tools, disconnect } = setup();
		const a = tools.add("right", {
			id: "browser-a",
			kind: "browser",
			data: { url: "https://example.com" },
		});
		const b = tools.add("right", {
			id: "browser-b",
			kind: "browser",
			data: { url: "about:blank" },
		});
		tools.move(b, "right", a);
		expect(tools.store.getState().tabs.map((t) => t.id)).toEqual([b, a]);
		tools.move(b, "bottom");
		expect(tools.state.getState().right.activeTabId).toBe(a);
		expect(tools.state.getState().bottom.activeTabId).toBe(b);
		expect(tools.store.getState().getPane("browser-b")?.tabId).toBe(b);
		tools.store.getState().closePane({ tabId: a, paneId: "browser-a" });
		expect(tools.state.getState().right.activeTabId).toBeNull();
		expect(tools.state.getState().placement[a]).toBeUndefined();
		disconnect();
	});
	test("fresh storage ignores the retired sidebar and round trips both dock layouts", async () => {
		const { tools, disconnect, values, storage } = setup(
			JSON.stringify({ rightSidebarEnabled: true, rightSidebarOpen: true }),
		);
		expect(tools.state.getState().right.open).toBe(false);
		await tools.open("right", "files");
		await tools.open("bottom", "browser");
		tools.resize("right", 515);
		tools.setOpen("bottom", false);
		disconnect();
		expect(values.get("test")).toContain('"size":515');
		const restored = createToolPanels({
			key: "test",
			storage,
			createTerminal: async () => "unexpected",
		});
		expect(restored.store.getState().tabs).toEqual(tools.store.getState().tabs);
		expect(restored.state.getState().bottom.open).toBe(false);
		expect(restored.state.getState().right.size).toBe(515);
		expect(restored.state.getState().focus).toBe("main");
	});
	test("a late shell launch honors a subsequent hide and rapid toggles launch once", async () => {
		let resolveLaunch!: (id: string) => void;
		let launches = 0;
		const tools = createToolPanels({
			key: "late",
			createTerminal: () => {
				launches++;
				return new Promise((resolve) => {
					resolveLaunch = resolve;
				});
			},
		});
		const disconnect = tools.connect();
		const first = tools.toggle("bottom");
		await tools.toggle("bottom");
		const second = tools.toggle("bottom");
		await tools.toggle("bottom");
		resolveLaunch("slow-shell");
		await Promise.all([first, second]);
		expect(launches).toBe(1);
		expect(tools.state.getState().bottom.open).toBe(false);
		expect(tools.state.getState().focus).toBe("main");
		expect(tools.store.getState().tabs).toHaveLength(1);
		disconnect();
	});
	test("Files is a single shared tool even after moving to the bottom panel", async () => {
		const { tools, disconnect } = setup();
		await tools.open("right", "files");
		const tabId = tools.store.getState().tabs[0].id;
		tools.move(tabId, "bottom");
		await tools.open("right", "files");
		expect(tools.store.getState().tabs).toHaveLength(1);
		expect(tools.state.getState().focus).toBe("bottom");
		disconnect();
	});
	test("malformed storage and non-finite sizes cannot break the shell", () => {
		const { tools, disconnect } = setup("broken json");
		tools.resize("right", Number.NaN);
		expect(tools.state.getState().right.size).toBe(420);
		expect(tools.store.getState().tabs).toEqual([]);
		disconnect();
	});
	test("only the upper-right leaf owns controls in nested splits", () => {
		const a = { type: "pane", paneId: "a" } as const;
		const b = { type: "pane", paneId: "b" } as const;
		const c = { type: "pane", paneId: "c" } as const;
		expect(panelButtonOwner(a)).toBe("a");
		expect(
			panelButtonOwner({
				type: "split",
				direction: "horizontal",
				first: a,
				second: { type: "split", direction: "vertical", first: b, second: c },
			}),
		).toBe("b");
	});
});
