/** Hidden Electron + an ephemeral Codex turn; touches only the audit fixture directory. */
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { app, BrowserWindow } from "electron";
import { installAgentBrowserAdapter } from "../src/main/lib/browser/agent-browser-adapter";
import { agentBrowserService } from "../src/main/lib/browser/agent-browser-service";
import { browserManager } from "../src/main/lib/browser/browser-manager";
import { CodexSessionManager } from "../src/main/lib/codex-session/session-manager";
import { CodexTransport } from "../src/main/lib/codex-session/transport";
import {
	type CodexSessionState,
	record,
} from "../src/shared/codex-session/types";

const output = resolve("../../.tmp/codex-activity-live");
const fixture = resolve(output, "fixture");
mkdirSync(fixture, { recursive: true });
writeFileSync(resolve(fixture, "activity.txt"), "before\n");
app.setPath("userData", resolve(output, "electron-profile"));
class EphemeralTransport extends CodexTransport {
	async request(method: string, params: unknown = {}): Promise<unknown> {
		if (method === "project/list") return { data: [] };
		if (method === "project/create") return {};
		return super.request(
			method,
			method === "thread/start"
				? { ...record(params), ephemeral: true }
				: params,
		);
	}
}
const transport = new EphemeralTransport();
const manager = new CodexSessionManager(transport);
const windows: BrowserWindow[] = [];
const server = createServer((_req, res) =>
	res.end(
		'<!doctype html><title>Activity verification</title><body style="background:#282a36;color:#f8f8f2;font:20px sans-serif;padding:40px"><h1>Codex activity capture</h1><p>Verified in an isolated preview.</p></body>',
	),
);
let timeout: ReturnType<typeof setTimeout> | undefined;
try {
	await app.whenReady();
	await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
	const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
	installAgentBrowserAdapter();
	agentBrowserService.on("open", (request) => {
		void (async () => {
			const window = new BrowserWindow({
				show: false,
				width: 800,
				height: 600,
				webPreferences: {
					sandbox: true,
					contextIsolation: true,
					nodeIntegration: false,
				},
			});
			windows.push(window);
			browserManager.register(request.paneId, window.webContents.id);
			await window.loadURL(request.url);
			agentBrowserService.acknowledge(request.requestId, request.workspaceId);
		})().catch((error: Error) =>
			agentBrowserService.acknowledge(
				request.requestId,
				request.workspaceId,
				error.message,
			),
		);
	});
	const state = await manager.start({
		key: "activity-audit",
		cwd: fixture,
		workspaceId: "activity-audit",
		model: "gpt-6-astra",
	});
	const observations = new Set<string>();
	const completed = new Promise<CodexSessionState>((done, fail) => {
		timeout = setTimeout(
			() => fail(new Error("Activity verification timed out")),
			180000,
		);
		manager.on("activity-audit", (snapshot: CodexSessionState) => {
			for (const item of snapshot.items)
				observations.add(`${item.activityType}:${item.status}`);
			for (const approval of snapshot.approvals)
				manager.answer(snapshot.key, approval.id, false);
			if (snapshot.error && snapshot.status !== "working")
				fail(new Error(snapshot.error));
			if (
				snapshot.status === "idle" &&
				snapshot.items.some((i) => i.kind === "assistant")
			)
				done(snapshot);
		});
	});
	await manager.send({
		key: state.key,
		model: "gpt-6-astra",
		effort: "xhigh",
		permission: "full-access",
		text: `This is a bounded integration check. Work only in ${fixture}. Read activity.txt using a shell command, change its contents from before to after using apply_patch, then run a shell command that prints the updated file. Use gatedspace_browser browser_open with session=codex:activity-audit to open ${url}, then use browser_screenshot to inspect it. This fixture is authorized. Do not inspect other folders or sites. Finish with one short sentence.`,
	});
	const result = await completed;
	assert.match(readFileSync(resolve(fixture, "activity.txt"), "utf8"), /after/);
	assert.ok(result.items.some((i) => i.command && i.text.includes("after")));
	assert.ok(result.items.some((i) => i.changes?.length));
	assert.ok(
		result.items.some((i) => i.activityType === "browser" && i.images?.length),
	);
	assert.ok(!result.items.some((i) => i.status === "inProgress"));
	assert.ok(result.turns?.some((t) => t.completedAt && t.startedAt));
	writeFileSync(
		resolve(output, "results.json"),
		JSON.stringify(
			{
				ok: true,
				observations: [...observations],
				turns: result.turns,
				items: result.items.map((i) => ({
					type: i.activityType,
					status: i.status,
					title: i.title,
					durationMs: i.durationMs,
					outputLength: i.text.length,
					images: i.images?.length,
					changes: i.changes?.length,
				})),
			},
			null,
			2,
		),
	);
	console.log(
		"Real Codex activity, file change, command output, browser capture and turn timing verified.",
	);
} catch (error) {
	writeFileSync(
		resolve(output, "results.json"),
		JSON.stringify(
			{
				ok: false,
				error: String(error),
				items: manager.get("activity-audit")?.items.map((i) => ({
					type: i.activityType,
					title: i.title,
					status: i.status,
					text: i.text.slice(0, 1500),
				})),
			},
			null,
			2,
		),
	);
	process.exitCode = 1;
} finally {
	clearTimeout(timeout);
	await manager.close("activity-audit").catch(() => {});
	manager.dispose();
	for (const window of windows) window.destroy();
	server.closeAllConnections();
	server.close();
	app.exit(process.exitCode || 0);
}
