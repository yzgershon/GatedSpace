import { expect, test } from "bun:test";
import { openAgentBrowserTab } from "../../../renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/components/WorkspaceToolPanels/agent-browser-tab";
import { createToolPanels } from "../../../renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/components/WorkspaceToolPanels/tool-panel-store";
import type { BrowserPaneData } from "../../../renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/types";
import {
	AgentBrowserService,
	type BrowserOpenRequest,
	type BrowserTool,
} from "./agent-browser-service";

function setup() {
	const tools = createToolPanels({
		key: "agent-browser",
		createTerminal: async () => "terminal",
	});
	const service = new AgentBrowserService();
	service.register("codex:a", "workspace-a");
	service.register("claude:b", "workspace-a");
	const operations: BrowserTool[] = [];
	service.adapter = {
		ready: async () => {},
		run: async (tool, paneId, input) => {
			operations.push(tool);
			if (tool === "browser_open") {
				const data = tools.store.getState().getPane(paneId)?.pane
					.data as BrowserPaneData;
				tools.store
					.getState()
					.setPaneData({ paneId, data: { ...data, url: input.url as string } });
			}
			return { content: [{ type: "text", text: "Page loaded" }] };
		},
	};
	service.on("open", (request: BrowserOpenRequest) => {
		try {
			service.acknowledge(
				request.requestId,
				request.workspaceId,
				openAgentBrowserTab(tools, request),
			);
		} catch (error) {
			service.acknowledge(
				request.requestId,
				request.workspaceId,
				undefined,
				String(error),
			);
		}
	});
	const run = (name: string, input: Record<string, string> = {}) =>
		service.run("codex", name, { session: "codex:a", ...input });
	return { tools, service, operations, run };
}
const tabId = (result: Awaited<ReturnType<AgentBrowserService["run"]>>) => {
	expect(result.isError).not.toBe(true);
	const item = result.content[0];
	if (item.type !== "text") throw new Error("Missing tab ID");
	return item.text.replace("tabId: ", "");
};

test("durable preview preparation preserves the session cwd and reuses a legacy tab", async () => {
	const { service, run, tools, operations } = setup();
	service.register("codex:a", "workspace-a", "C:/project");
	const original = "http://localhost:3000/";
	const first = tabId(await run("browser_open", { url: original }));
	const durable = "gatedspace-preview://0123456789abcdef0123456789abcdef/";
	let seen: unknown;
	service.previews = {
		prepare: async (url, directory, cwd) => {
			seen = { url, directory, cwd };
			return { url: durable, updated: true };
		},
	};
	expect(
		tabId(
			await run("browser_open", {
				url: original,
				previewDirectory: ".tmp/preview",
			}),
		),
	).toBe(first);
	expect(seen).toEqual({
		url: original,
		directory: ".tmp/preview",
		cwd: "C:/project",
	});
	expect(tools.store.getState().tabs).toHaveLength(1);
	expect(operations.at(-1)).toBe("browser_open");
	service.previews.prepare = async () => ({ url: durable, updated: false });
	expect(
		tabId(await run("browser_open", { previewDirectory: ".tmp/preview" })),
	).toBe(first);
	expect(operations.at(-1)).toBe("browser_snapshot");
});

test("preview folders require a session workspace; unregister removes recovery roots", async () => {
	const { service, run } = setup();
	expect(
		(await run("browser_open", { previewDirectory: "C:/folder" })).isError,
	).toBe(true);
	service.register("codex:a", "workspace-a", "C:/project");
	expect(service.workspaceDirectories()).toEqual(["C:/project"]);
	service.unregister("codex:a");
	expect(service.workspaceDirectories()).toEqual([]);
});

test("repeated and concurrent preview opens reuse one tab without navigating again", async () => {
	const { tools, run, operations } = setup();
	const first = tabId(
		await run("browser_open", { url: "http://LOCALHOST:3000" }),
	);
	const results = await Promise.all(
		Array.from({ length: 15 }, () =>
			run("browser_open", { url: "http://localhost:3000/" }),
		),
	);
	for (const result of results) expect(tabId(result)).toBe(first);
	expect(tools.store.getState().tabs).toHaveLength(1);
	expect(operations.filter((op) => op === "browser_open")).toHaveLength(1);
	expect(operations.filter((op) => op === "browser_snapshot")).toHaveLength(15);
});

test("listing leaves selection alone; selecting an old preview focuses without navigation", async () => {
	const { tools, run, operations } = setup();
	const first = tabId(
		await run("browser_open", { url: "http://localhost:3000/one" }),
	);
	const second = tabId(
		await run("browser_open", { url: "http://localhost:3000/two" }),
	);
	const before = tools.state.getState();
	const listed = await run("browser_tabs");
	expect(listed.isError).not.toBe(true);
	const text = listed.content[0];
	expect(
		text.type === "text" &&
			JSON.parse(text.text).tabs.map((t: { tabId: string }) => t.tabId),
	).toEqual([first, second]);
	expect(tools.state.getState()).toBe(before);
	expect(tabId(await run("browser_select", { tabId: first }))).toBe(first);
	expect(operations).toEqual([
		"browser_open",
		"browser_open",
		"browser_snapshot",
	]);
	expect(tools.store.getState().getActivePane()?.pane.id).toBe(first);
	expect(tools.store.getState().tabs).toHaveLength(2);
});

test("an explicit existing tab ID navigates that tab to a different preview URL", async () => {
	const { tools, run, operations } = setup();
	const first = tabId(
		await run("browser_open", { url: "http://localhost:3000/" }),
	);
	expect(
		tabId(
			await run("browser_open", {
				tabId: first,
				url: "http://localhost:4000/next",
			}),
		),
	).toBe(first);
	expect(
		tabId(await run("browser_open", { url: "http://localhost:4000/next" })),
	).toBe(first);
	expect(operations).toEqual([
		"browser_open",
		"browser_open",
		"browser_snapshot",
	]);
	expect(tools.store.getState().tabs).toHaveLength(1);
});

test("session registration restores owned tabs and permits selecting them after restart", async () => {
	const { tools, service, run } = setup();
	const first = tabId(
		await run("browser_open", { url: "https://example.com" }),
	);
	service.unregister("codex:a");
	expect((await run("browser_tabs")).isError).toBe(true);
	service.register("codex:a", "workspace-a");
	expect(tabId(await run("browser_select", { tabId: first }))).toBe(first);
	expect(
		tabId(await run("browser_open", { url: "https://example.com/" })),
	).toBe(first);
	expect(tools.store.getState().tabs).toHaveLength(1);
});

test("another agent's matching URL never grants access to its tab", async () => {
	const { service, run, tools } = setup();
	const first = tabId(
		await run("browser_open", { url: "https://example.com" }),
	);
	expect(
		(await service.run("claude:b", "browser_snapshot", { tabId: first }))
			.isError,
	).toBe(true);
	expect(
		(await service.run("claude:b", "browser_select", { tabId: first })).isError,
	).toBe(true);
	const second = tabId(
		await service.run("claude:b", "browser_open", {
			url: "https://example.com/",
		}),
	);
	expect(second).not.toBe(first);
	expect(tools.store.getState().tabs).toHaveLength(2);
	expect(
		(
			await run("browser_open", {
				session: "claude:b",
				url: "https://example.com",
			})
		).isError,
	).toBe(true);
});

test("closed tabs disappear from discovery; selecting does not reopen but open can recreate", async () => {
	const { tools, run } = setup();
	const first = tabId(
		await run("browser_open", { url: "https://example.com" }),
	);
	tools.store.getState().removeTab(tools.store.getState().tabs[0].id);
	expect((await run("browser_select", { tabId: first })).isError).toBe(true);
	expect(tools.store.getState().tabs).toHaveLength(0);
	const list = (await run("browser_tabs")).content[0];
	expect(list.type === "text" && JSON.parse(list.text).tabs).toEqual([]);
	expect(
		tabId(await run("browser_open", { url: "https://example.com" })),
	).not.toBe(first);
	expect(tools.store.getState().tabs).toHaveLength(1);
});

test("invalid URLs and missing tab selections never create a pane", async () => {
	const { tools, run } = setup();
	for (const url of [
		"file:///C:/Users/test/secret",
		"https://user:password@example.com",
		"javascript:alert(1)",
		"",
	]) {
		expect((await run("browser_open", { url })).isError).toBe(true);
	}
	expect((await run("browser_select")).isError).toBe(true);
	expect(tools.store.getState().tabs).toHaveLength(0);
});

test("closing a session cancels pending requests and ignores late acknowledgements", async () => {
	const service = new AgentBrowserService();
	service.adapter = {
		ready: async () => {},
		run: async () => ({ content: [] }),
	};
	service.register("codex:a", "workspace-a");
	const result = service.run("codex", "browser_tabs", { session: "codex:a" });
	const request = service.requests("workspace-a")[0];
	expect(request.action).toBe("list");
	service.acknowledge(request.requestId, "wrong-workspace", { tabs: [] });
	expect(service.requests("workspace-a")).toHaveLength(1);
	service.unregister("codex:a");
	expect((await result).isError).toBe(true);
	service.acknowledge(request.requestId, "workspace-a", { tabs: [] });
	expect(service.requests("workspace-a")).toHaveLength(0);
});
