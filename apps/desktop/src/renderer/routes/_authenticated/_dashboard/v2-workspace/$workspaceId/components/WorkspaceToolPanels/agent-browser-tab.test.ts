import { expect, test } from "bun:test";
import { openAgentBrowserTab } from "./agent-browser-tab";
import { createToolPanels } from "./tool-panel-store";

test("agent previews open in the shared right panel, reopen once, and preserve other tabs", async () => {
	const tools = createToolPanels({
		key: "agent-browser-test",
		createTerminal: async () => "terminal",
	});
	const disconnect = tools.connect();
	await tools.open("bottom", "terminal");
	const bottom = tools.state.getState().bottom;
	const width = tools.state.getState().right.size;
	const request = {
		requestId: "request",
		workspaceId: "workspace",
		sessionKey: "codex:a",
		knownPaneIds: [],
		action: "open" as const,
		paneId: "agent-browser-1",
		url: "http://localhost:3000/",
	};
	openAgentBrowserTab(tools, request);
	expect(tools.state.getState().right.open).toBe(true);
	const id = tools.state.getState().right.activeTabId;
	expect(
		tools.store.getState().tabs.find((t) => t.id === id)?.panes[request.paneId],
	).toMatchObject({
		kind: "browser",
		data: { url: request.url, previewMode: "responsive" },
	});
	expect(tools.state.getState().right.size).toBe(width);
	await tools.toggle("right");
	openAgentBrowserTab(tools, request);
	expect(tools.state.getState().right).toMatchObject({
		open: true,
		activeTabId: id,
	});
	expect(tools.store.getState().tabs).toHaveLength(2);
	expect(tools.state.getState().bottom).toEqual(bottom);
	disconnect();
});

test("persisted agent previews are reused in their original bottom placement and mobile mode", () => {
	const storage = new Map<string, string>();
	const options = {
		key: "restore-preview",
		createTerminal: async () => "terminal",
		storage: {
			getItem: (key: string) => storage.get(key) ?? null,
			setItem: (key: string, value: string) => {
				storage.set(key, value);
			},
		},
	};
	const original = createToolPanels(options);
	const off = original.connect();
	const id = original.add("bottom", {
		id: "preview-1",
		kind: "browser",
		data: {
			url: "https://example.com/",
			agentSessionKey: "codex:a",
			previewMode: "galaxy-s24",
			previewOrientation: "landscape",
		},
	});
	off();
	const tools = createToolPanels(options);
	tools.setOpen("bottom", false);
	const beforeSize = tools.state.getState().bottom.size;
	const request = {
		requestId: "request",
		workspaceId: "workspace",
		sessionKey: "codex:a",
		knownPaneIds: [],
		action: "open" as const,
		url: "https://EXAMPLE.com:443",
	};
	expect(openAgentBrowserTab(tools, request)).toMatchObject({
		paneId: "preview-1",
		reused: true,
	});
	expect(tools.store.getState().tabs).toHaveLength(1);
	expect(tools.state.getState().bottom).toMatchObject({
		open: true,
		activeTabId: id,
		size: beforeSize,
	});
	expect(tools.state.getState().right.open).toBe(false);
	expect(tools.store.getState().getPane("preview-1")?.pane.data).toMatchObject({
		previewMode: "galaxy-s24",
		previewOrientation: "landscape",
	});
});

test("different ports, routes, queries and anchors remain separate pages", () => {
	const tools = createToolPanels({
		key: "url-preview",
		createTerminal: async () => "terminal",
	});
	const request = {
		requestId: "request",
		workspaceId: "workspace",
		sessionKey: "codex:a",
		knownPaneIds: [],
		action: "open" as const,
	};
	for (const url of [
		"http://localhost:3000/",
		"http://localhost:3001/",
		"http://localhost:3000/path",
		"http://localhost:3000/?mode=mobile",
		"http://localhost:3000/#second",
	]) {
		openAgentBrowserTab(tools, { ...request, url });
	}
	expect(tools.store.getState().tabs).toHaveLength(5);
});

test("manual tabs stay untouched; legacy owned tabs can be selected and tagged", () => {
	const tools = createToolPanels({
		key: "legacy-preview",
		createTerminal: async () => "terminal",
	});
	tools.add("right", {
		id: "manual",
		kind: "browser",
		data: { url: "https://example.com/" },
	});
	tools.add("right", {
		id: "legacy",
		kind: "browser",
		data: { url: "https://example.com/" },
	});
	const result = openAgentBrowserTab(tools, {
		requestId: "request",
		workspaceId: "workspace",
		sessionKey: "codex:a",
		knownPaneIds: ["legacy"],
		action: "open",
		url: "https://example.com/",
	});
	expect(result.paneId).toBe("legacy");
	expect(result.tabs.map((t) => t.tabId)).toEqual(["legacy"]);
	expect(tools.store.getState().getPane("legacy")?.pane.data).toMatchObject({
		agentSessionKey: "codex:a",
	});
	expect(
		tools.store.getState().getPane("manual")?.pane.data,
	).not.toHaveProperty("agentSessionKey");
});

test("selecting a preview reveals its pane when a sibling was maximized", () => {
	const tools = createToolPanels({
		key: "split-preview",
		createTerminal: async () => "terminal",
	});
	tools.store.getState().addTab({
		id: "split",
		panes: [
			{
				id: "preview",
				kind: "browser",
				data: { url: "https://example.com/", agentSessionKey: "codex:a" },
			},
			{ id: "sibling", kind: "browser", data: { url: "https://example.org/" } },
		],
	});
	tools.store
		.getState()
		.toggleMaximizePane({ tabId: "split", paneId: "sibling" });
	openAgentBrowserTab(tools, {
		requestId: "request",
		workspaceId: "workspace",
		sessionKey: "codex:a",
		knownPaneIds: [],
		action: "select",
		paneId: "preview",
	});
	expect(tools.store.getState().getTab("split")).toMatchObject({
		maximizedPaneId: null,
		activePaneId: "preview",
	});
	expect(tools.state.getState().right).toMatchObject({
		open: true,
		activeTabId: "split",
	});
});
