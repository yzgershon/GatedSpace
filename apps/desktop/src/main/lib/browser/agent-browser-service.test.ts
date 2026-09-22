import { expect, test } from "bun:test";
import { AgentBrowserService } from "./agent-browser-service";

test("agent preview opens in its workspace and operations stay scoped to its tabs", async () => {
	const service = new AgentBrowserService();
	service.register("codex:a", "workspace-a");
	service.register("claude:b", "workspace-b");
	service.adapter = {
		ready: async () => {},
		run: async () => ({ content: [{ type: "text", text: "Page loaded" }] }),
	};
	let paneId = "";
	service.on("open", (request) => {
		expect(request.workspaceId).toBe("workspace-a");
		paneId = request.paneId;
		service.acknowledge(request.requestId, request.workspaceId);
	});
	const opened = await service.run("codex", "browser_open", {
		session: "codex:a",
		url: "http://localhost:3000",
	});
	expect(opened.isError).not.toBe(true);
	expect(paneId).toStartWith("agent-browser-");
	expect(
		(await service.run("claude:b", "browser_snapshot", { tabId: paneId }))
			.isError,
	).toBe(true);
	expect(
		(
			await service.run("codex", "browser_snapshot", {
				session: "claude:b",
				tabId: paneId,
			})
		).isError,
	).toBe(true);
	expect(
		(
			await service.run("codex", "browser_open", {
				session: "codex:a",
				url: "file:///C:/Users/test/secret",
			})
		).isError,
	).toBe(true);
	service.unregister("codex:a");
	expect(
		(
			await service.run("codex", "browser_snapshot", {
				session: "codex:a",
				tabId: paneId,
			})
		).isError,
	).toBe(true);
});
