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
	const request = { paneId: "agent-browser-1", url: "http://localhost:3000" };
	openAgentBrowserTab(tools, request);
	expect(tools.state.getState().right.open).toBe(true);
	const id = tools.state.getState().right.activeTabId;
	expect(
		tools.store.getState().tabs.find((t) => t.id === id)?.panes[request.paneId],
	).toMatchObject({
		kind: "browser",
		data: { url: request.url, previewMode: "desktop" },
	});
	expect(tools.state.getState().right.size).toBe(720);
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
