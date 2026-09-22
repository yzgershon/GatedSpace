/** Run the bundled script with Electron. Uses a hidden, isolated browser profile.
 * Set GATEDSPACE_LIVE_AGENT_CHECK=1 for one bounded Claude Haiku turn as well. */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { app, BrowserWindow } from "electron";
import { installAgentBrowserAdapter } from "../src/main/lib/browser/agent-browser-adapter";
import { agentBrowserMcp } from "../src/main/lib/browser/agent-browser-mcp";
import { agentBrowserService } from "../src/main/lib/browser/agent-browser-service";
import { browserManager } from "../src/main/lib/browser/browser-manager";
import { resolveNativeClaude } from "../src/main/lib/claude-session/resolve-native";
import { ClaudeSessionTransport } from "../src/main/lib/claude-session/transport";
import { CodexTransport } from "../src/main/lib/codex-session/transport";
import { list, record, text } from "../src/shared/codex-session/types";

const output = resolve(
	process.env.GATEDSPACE_AUDIT_DIR ?? "../../.tmp/native-browser-check",
);
mkdirSync(output, { recursive: true });
app.setPath("userData", resolve(output, "electron-profile"));
const checks: string[] = [];
const windows: BrowserWindow[] = [];
const server = createServer((_req, res) =>
	res.end(
		'<!doctype html><title>GatedSpace browser check</title><style>body{font:20px sans-serif;background:#282a36;color:white;padding:40px}input,button{padding:12px;margin:8px}</style><h1>Preview verification</h1><label>Name <input aria-label="Name" oninput="document.querySelector(\'#value\').textContent=this.value"></label><p id="value">Empty</p><button onclick="this.textContent=\'Clicked successfully\'">Verify button</button>',
	),
);
const codex = new CodexTransport();
let claude: ClaudeSessionTransport | undefined;
let client: Client | undefined;
try {
	await app.whenReady();
	await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
	const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
	installAgentBrowserAdapter();
	agentBrowserService.on("open", (request) => {
		void (async () => {
			let wc = browserManager.getWebContents(request.paneId);
			if (!wc) {
				const window = new BrowserWindow({
					show: false,
					width: 960,
					height: 700,
					webPreferences: {
						sandbox: true,
						contextIsolation: true,
						nodeIntegration: false,
					},
				});
				windows.push(window);
				wc = window.webContents;
				browserManager.register(request.paneId, wc.id);
				await wc.loadURL(request.url);
			}
			agentBrowserService.acknowledge(request.requestId, request.workspaceId);
		})().catch((error: Error) =>
			agentBrowserService.acknowledge(
				request.requestId,
				request.workspaceId,
				error.message,
			),
		);
	});
	agentBrowserService.register("claude:check", "workspace-check");
	const bridge = await agentBrowserMcp.connect("claude:check");
	assert.equal(
		(await fetch(bridge.url, { method: "POST", body: "{}" })).status,
		403,
	);
	assert.equal(
		(
			await fetch(bridge.url, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${bridge.token}`,
					Origin: "https://untrusted.example",
				},
				body: "{}",
			})
		).status,
		403,
	);
	checks.push(
		"loopback bridge rejects missing credentials and browser origins",
	);
	client = new Client({ name: "gatedspace-verification", version: "1" });
	await client.connect(
		new StreamableHTTPClientTransport(new URL(bridge.url), {
			requestInit: { headers: { Authorization: `Bearer ${bridge.token}` } },
		}),
	);
	assert.equal((await client.listTools()).tools.length, 8);
	const call = async (name: string, args: Record<string, unknown>) => {
		const result = await client?.callTool({ name, arguments: args });
		assert.notEqual(result.isError, true, JSON.stringify(result));
		return result;
	};
	const opened = await call("browser_open", { url });
	const contents = list(opened.content).map(record);
	const tabId = text(contents[0].text).replace("tabId: ", "");
	const page = JSON.parse(text(contents[1].text));
	const inputRef = page.elements.find(
		(e: { tag: string }) => e.tag === "input",
	).ref;
	const filled = await call("browser_fill", {
		tabId,
		ref: inputRef,
		text: "Verified inside GatedSpace",
	});
	assert.match(JSON.stringify(filled), /Verified inside GatedSpace/);
	const filledPage = JSON.parse(text(record(list(filled.content)[1]).text));
	const buttonRef = filledPage.elements.find(
		(e: { tag: string }) => e.tag === "button",
	).ref;
	assert.match(
		JSON.stringify(await call("browser_click", { tabId, ref: buttonRef })),
		/Clicked successfully/,
	);
	await call("browser_press", { tabId, key: "Tab" });
	await call("browser_scroll", { tabId, direction: "down" });
	await call("browser_console", { tabId });
	const screenshot = await call("browser_screenshot", { tabId });
	const picture = list(screenshot.content)
		.map(record)
		.find((c) => c.type === "image");
	assert.ok(picture && text(picture.data).length > 1000);
	writeFileSync(
		resolve(output, "browser-verification.png"),
		Buffer.from(text(picture.data), "base64"),
	);
	checks.push(
		"real Electron page open, snapshot, fill, click, key, scroll, console and screenshot",
	);
	const google = await call("browser_open", {
		tabId,
		url: "https://www.google.com",
	});
	assert.match(JSON.stringify(google), /google\.com/);
	checks.push("external Google HTTPS navigation");

	// Exercise the actual Codex process, including MCP inherited by its threads.
	agentBrowserService.register("codex:check", "workspace-check");
	const started = record(
		await codex.request("thread/start", { cwd: output, ephemeral: true }),
	);
	const threadId = text(record(started.thread).id);
	const codexResult = record(
		await codex.request("mcpServer/tool/call", {
			threadId,
			server: "gatedspace_browser",
			tool: "browser_open",
			arguments: { session: "codex:check", url },
		}),
	);
	assert.notEqual(codexResult.isError, true, JSON.stringify(codexResult));
	assert.match(JSON.stringify(codexResult), /Preview verification/);
	checks.push("installed Codex app-server calls the real browser MCP tool");
	const liveAgent = ["1", "claude"].includes(
		process.env.GATEDSPACE_LIVE_AGENT_CHECK ?? "",
	);
	if (process.env.GATEDSPACE_LIVE_AGENT_CHECK === "1") {
		const completed = new Promise<void>((done, fail) => {
			const timer = setTimeout(
				() => fail(new Error("Codex browser verification timed out")),
				90_000,
			);
			let usedBrowser = false;
			codex.on("request", (request) => {
				codex.reject(
					request.id,
					"Unexpected permission request in isolated browser test",
				);
			});
			codex.on("notification", (event) => {
				const p = record(event.params);
				if (p.threadId !== threadId) return;
				if (JSON.stringify(event).includes('"server":"gatedspace_browser"'))
					usedBrowser = true;
				if (event.method !== "turn/completed") return;
				clearTimeout(timer);
				const turn = record(p.turn);
				if (turn.error || !usedBrowser)
					fail(new Error(`Codex browser turn failed: ${JSON.stringify(turn)}`));
				else done();
			});
		});
		await codex.request("turn/start", {
			threadId,
			model: "gpt-6-astra",
			effort: "xhigh",
			approvalPolicy: "on-request",
			input: [
				{
					type: "text",
					text: `Use gatedspace_browser browser_open with session=codex:check to open ${url}. Then click Verify button with browser_click. Only use those browser tools and reply with the changed button label. This is an isolated fixture and I authorize the click.`,
				},
			],
		});
		await completed;
		assert.equal(
			await windows
				.at(-1)
				?.webContents.executeJavaScript(
					"document.querySelector('button')?.textContent",
				),
			"Clicked successfully",
		);
		checks.push(
			"real GPT-6 Astra turn autonomously opens and verifies the browser fixture",
		);
	}
	await codex.request("thread/unsubscribe", { threadId });

	// Prepend the exact managed wrapper directory that broke --settings before.
	const wrapper = resolve(process.env.USERPROFILE ?? "", ".superset", "bin");
	process.env.PATH = `${wrapper};${process.env.PATH}`;
	// The saved Settings > Agents preset that failed in 1.18.12. Testing bare
	// `claude` here previously missed the account-wrapper alias entirely.
	assert.ok(!resolveNativeClaude("claude-acct").command.includes(".superset"));
	claude = new ClaudeSessionTransport({
		binary: "claude-acct",
		cwd: output,
		workspaceId: "workspace-check",
		sessionKey: "native-check",
		model: liveAgent ? "haiku" : undefined,
		permissionMode: "acceptEdits",
		extraArgs: [
			"--permission-mode",
			"auto",
			"--chrome",
			"--no-session-persistence",
			"--max-turns",
			"4",
			"--settings",
			'{"disableAllHooks":true}',
		],
	});
	const agentResult = new Promise<void>((done, fail) => {
		if (!liveAgent) {
			done();
			return;
		}
		const timeout = setTimeout(
			() => fail(new Error("Claude browser verification turn timed out")),
			90_000,
		);
		let called = false;
		let approved = 0;
		claude?.on("event", (event) => {
			if (event.type === "local_permissions") {
				for (const request of event.requests) {
					const allowed =
						request.tool === "mcp__gatedspace_browser__browser_open"
							? request.input.url === url
							: request.tool === "mcp__gatedspace_browser__browser_click" ||
								request.tool === "mcp__gatedspace_browser__browser_snapshot";
					if (allowed) approved++;
					claude?.answerPermission(request.id, allowed);
				}
			}
			if (
				event.type === "assistant" &&
				JSON.stringify(event).includes("mcp__gatedspace_browser__browser_open")
			)
				called = true;
			if (event.type !== "result") return;
			clearTimeout(timeout);
			if (
				!called ||
				approved === 0 ||
				list(event.permission_denials).length ||
				event.is_error
			)
				fail(
					new Error(
						`Claude tool turn failed: ${JSON.stringify({ called, denied: event.permission_denials, result: event.result })}`,
					),
				);
			else done();
		});
	});
	const launched = new Promise<void>((done, fail) => {
		const timeout = setTimeout(
			() => fail(new Error("Claude init timeout")),
			90_000,
		);
		claude?.on("error", fail);
		claude?.on("stderr", (line) => {
			if (/Invalid JSON/.test(line)) fail(new Error(line));
		});
		claude?.on("event", (event) => {
			if (event.type !== "system" || event.subtype !== "init") return;
			const tools = list(event.tools).map(text);
			if (
				!tools.some(
					(t) => t.includes("gatedspace_browser") && t.endsWith("browser_open"),
				)
			) {
				clearTimeout(timeout);
				fail(
					new Error(
						`Claude browser tools missing: ${JSON.stringify(event.mcp_servers)}`,
					),
				);
				return;
			}
			clearTimeout(timeout);
			done();
		});
	});
	claude.start();
	claude.sendUserMessage(
		liveAgent
			? `Use mcp__gatedspace_browser__browser_open to open ${url} in GatedSpace and read the page. Then use browser_click to click the Verify button and report its changed label. Only use these browser tools, no other tools. This is an isolated test page and I authorize that click.`
			: "/model",
	);
	await launched;
	await agentResult;
	if (liveAgent) {
		assert.equal(
			await windows
				.at(-1)
				?.webContents.executeJavaScript(
					"document.querySelector('button')?.textContent",
				),
			"Clicked successfully",
		);
		checks.push(
			"Claude Auto mode receives an explicit stdio approval and opens/clicks the preview",
		);
	}
	checks.push(
		"saved claude-acct preset starts with managed wrapper first on PATH, accepts JSON settings and discovers all browser tools",
	);
	writeFileSync(
		resolve(output, "results.json"),
		JSON.stringify({ ok: true, checks }, null, 2),
	);
	console.log(JSON.stringify({ ok: true, checks }));
} catch (error) {
	console.error(error);
	writeFileSync(
		resolve(output, "results.json"),
		JSON.stringify({ ok: false, checks, error: String(error) }, null, 2),
	);
	process.exitCode = 1;
} finally {
	claude?.dispose();
	codex.dispose();
	await client?.close();
	agentBrowserMcp.dispose();
	server.closeAllConnections();
	server.close();
	browserManager.unregisterAll();
	for (const window of windows) if (!window.isDestroyed()) window.destroy();
	await delay(100);
	app.exit(process.exitCode || 0);
}
