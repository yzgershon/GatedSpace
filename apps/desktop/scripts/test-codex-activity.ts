/** Real production Codex components in an isolated browser, with deterministic IPC fixtures. */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { build } from "vite";

// Set PLAYWRIGHT_MODULE when using an existing tool runtime instead of a local install.
const { chromium } = await import(
	process.env.PLAYWRIGHT_MODULE ?? "playwright"
);

const releaseCss = process.env.ACTIVITY_RELEASE_CSS;
const output = resolve(
	import.meta.dirname,
	releaseCss
		? "../../../.tmp/codex-activity-release-ui"
		: "../../../.tmp/codex-activity-ui",
);
await mkdir(output, { recursive: true });
await build({
	configFile: false,
	envFile: false,
	logLevel: "warn",
	plugins: [
		react(),
		tailwindcss(),
		{
			name: "fixture-ipc",
			enforce: "pre",
			load(id) {
				if (/[/\\]renderer[/\\]lib[/\\]electron-trpc\.ts$/.test(id))
					return readFile(
						resolve(import.meta.dirname, "codex-session/fixture-usage.ts"),
						"utf8",
					);
				if (/[/\\]useSkinTokens[/\\]useSkinTokens\.ts$/.test(id))
					return 'import { VSCODE_TOKENS, LIQUID_GLASS_TOKENS } from "./skin-tokens"; export function useSkinTokens() { return location.search.includes("loading") ? {...VSCODE_TOKENS,paneGap:18,paneRadius:8,paneSurface:"raised"} : location.search.includes("inline") ? LIQUID_GLASS_TOKENS : VSCODE_TOKENS; }';
				if (/[/\\]renderer[/\\]lib[/\\]trpc-client\.ts$/.test(id))
					return readFile(
						resolve(import.meta.dirname, "codex-session/fixture-client.ts"),
						"utf8",
					);
			},
		},
	],
	resolve: {
		alias: {
			renderer: resolve(import.meta.dirname, "../src/renderer"),
			shared: resolve(import.meta.dirname, "../src/shared"),
		},
	},
	define: {
		"process.env": "{}",
		"process.platform": JSON.stringify(process.platform),
	},
	build: {
		outDir: output,
		emptyOutDir: false,
		minify: false,
		lib: {
			entry: resolve(import.meta.dirname, "codex-session/renderer.tsx"),
			formats: ["iife"],
			name: "CodexFixture",
			fileName: () => "renderer.js",
			cssFileName: "style",
		},
	},
});
await writeFile(
	resolve(output, "index.html"),
	'<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/style.css"></head><body><script src="/renderer.js"></script></body></html>',
);
// Check the shipped cascade too: an isolated fixture can hide CSS ordering bugs.
if (releaseCss) {
	const html = await readFile(resolve(releaseCss, "index.html"), "utf8");
	const entry = html.match(/href="\.\/assets\/([^"<>]+\.css)"/)?.[1];
	if (!entry) throw new Error("Release entry CSS not found");
	const assets = resolve(releaseCss, "assets");
	const files = [
		entry,
		...(await readdir(assets)).filter((f) => f.endsWith(".css") && f !== entry),
	];
	const css = await Promise.all(
		files.map((file) => readFile(resolve(assets, file), "utf8")),
	);
	await writeFile(resolve(output, "style.css"), css.join("\n"));
}
const server = createServer(async (request, response) => {
	try {
		const name = new URL(request.url ?? "/", "http://localhost").pathname;
		const file = name === "/" ? "index.html" : name.slice(1);
		if (!["index.html", "renderer.js", "style.css"].includes(file)) {
			response.writeHead(404).end();
			return;
		}
		response.setHeader(
			"Content-Type",
			file.endsWith(".js")
				? "text/javascript"
				: file.endsWith(".css")
					? "text/css"
					: "text/html",
		);
		response.end(await readFile(resolve(output, file)));
	} catch {
		response.writeHead(500).end();
	}
});
await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
const port = (server.address() as { port: number }).port;
const browser = await chromium.launch({ channel: "chrome", headless: true });
const checks: string[] = [];
const errors: string[] = [];
try {
	const page = await browser.newPage({
		viewport: { width: 1400, height: 1000 },
		deviceScaleFactor: 1.5,
	});
	page.on("pageerror", (e) => errors.push(e.message));
	await page.goto(`http://127.0.0.1:${port}/?paired`);
	await page.getByRole("textbox", { name: "Message Codex" }).waitFor();
	async function update(patch: unknown) {
		await page.evaluate(
			(value) =>
				(
					window as unknown as { setCodexActivityFixture(p: unknown): void }
				).setCodexActivityFixture(value),
			patch,
		);
	}
	const base = {
		turnId: "desktop-turn",
		kind: "activity",
		status: "completed",
	};
	await update({
		items: [
			{
				id: "prompt",
				turnId: "thinking",
				kind: "user",
				title: "",
				text: "Check the workspace layout.",
			},
		],
		status: "working",
		turnId: "thinking",
		workingSince: Date.now(),
		historyCursor: null,
	});
	const heading = page.locator(".codex-work-heading");
	await heading.getByText("Thinking", { exact: true }).waitFor();
	await page.waitForTimeout(200);
	const wave = page.locator(".codex-thinking-wave i").first();
	if (
		(await wave.evaluate((el) => getComputedStyle(el).animationName)) !==
		"codex-thought-wave"
	)
		throw Error("Thinking motion missing");
	const start = await heading.boundingBox();
	await page.waitForTimeout(1100);
	const end = await heading.boundingBox();
	if (
		!start ||
		!end ||
		Math.abs(start.y - end.y) > 1 ||
		Math.abs(start.height - end.height) > 1
	)
		throw Error("Thinking animation shifted layout");
	await page.screenshot({ path: resolve(output, "thinking.png") });
	await update({
		approvals: [
			{
				id: "wait",
				title: "Approval needed",
				method: "approval",
				detail: "Allow this action?",
				questions: [],
			},
		],
	});
	await heading.getByText("Waiting for your response").waitFor();
	if (await page.locator(".codex-thinking-wave").count())
		throw Error("Waiting state still animates");
	await update({
		approvals: [],
		status: "idle",
		turnId: null,
		turns: [{ id: "thinking", status: "interrupted", durationMs: 2000 }],
	});
	await heading.getByText("Stopped for 2s").waitFor();
	if (await page.locator(".codex-thinking-wave").count())
		throw Error("Stopped state still animates");
	checks.push("thinking is stable, approval and interruption stop motion");
	const items = [
		{
			...base,
			id: "u",
			kind: "user",
			title: "",
			text: "Make the sidebar open with a tool menu. Keep my browser tabs.",
		},
		{
			...base,
			id: "comment",
			kind: "assistant",
			phase: "commentary",
			title: "",
			text: "I’ll check the sidebar, update the empty state, then verify the result in the browser.",
		},
		{
			...base,
			id: "cmd",
			activityType: "commandExecution",
			title: "rg -n toggleRight src",
			command: "rg -n toggleRight src",
			cwd: "C:/Dev/superset",
			text: "tool-panel-store.ts:124 toggleRight()",
			exitCode: 0,
			durationMs: 2400,
		},
		{
			...base,
			id: "read",
			activityType: "read",
			title: "Read ToolPanel.tsx",
			command: "Get-Content ToolPanel.tsx",
			text: "export function ToolPanel() { return <Tools />; }",
			durationMs: 1000,
		},
		{
			...base,
			id: "comment2",
			kind: "assistant",
			phase: "commentary",
			title: "",
			text: "The toggle opens a blank browser. I’m changing it to show the tool chooser.",
		},
		{
			...base,
			id: "edit",
			activityType: "fileChange",
			title: "Edited files",
			text: "",
			changes: [
				{
					path: "ToolPanel.tsx",
					kind: "update",
					diff: "@@ -1 +1 @@\n- openBrowser()\n+ showToolChooser()",
				},
			],
			durationMs: 2000,
		},
		{
			...base,
			id: "browser",
			activityType: "browser",
			tool: "browser_screenshot",
			title: "Browser capture",
			text: "Captured the tool chooser.",
			images: [
				"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
			],
		},
		{
			...base,
			id: "tests",
			activityType: "commandExecution",
			status: "inProgress",
			title: "bun test",
			command: "bun test",
			text: "Running tool-panel tests…",
		},
	];
	await update({
		items,
		status: "working",
		turnId: "desktop-turn",
		workingSince: Date.now() - 18000,
		turns: [
			{
				id: "desktop-turn",
				status: "inProgress",
				startedAt: Date.now() - 18000,
			},
		],
		diff: "",
		historyCursor: null,
	});
	await page.getByRole("button", { name: /Running bun test/ }).click();
	await heading.getByText("Running commands", { exact: true }).waitFor();
	await page.getByText("Running tool-panel tests…", { exact: true }).waitFor();
	await page.waitForTimeout(400);
	await page.screenshot({ path: resolve(output, "desktop-live.png") });
	const activeAnimation = await page
		.locator(".codex-action-motion")
		.evaluate((e: HTMLElement) => getComputedStyle(e).animationName);
	if (activeAnimation !== "codex-action-slide")
		throw Error("Missing active tool animation");
	checks.push(
		"production Desktop feed renders live commands, commentary and grouped actions",
	);
	await update({
		items: items
			.map((i) =>
				i.id === "tests"
					? {
							...i,
							text: "12 pass · 0 fail",
							status: "completed",
							exitCode: 0,
							durationMs: 4500,
						}
					: i,
			)
			.concat([
				{
					...base,
					id: "final",
					kind: "assistant",
					phase: "final_answer",
					title: "",
					text: "The sidebar now opens with the tool chooser. All checks passed.",
				},
			]),
		status: "idle",
		turnId: null,
		turns: [
			{
				id: "desktop-turn",
				status: "completed",
				startedAt: 1000,
				completedAt: 39000,
				durationMs: 38000,
			},
		],
	});
	await page.getByText("12 pass · 0 fail", { exact: true }).waitFor();
	if (await page.locator(".codex-action-motion").count())
		throw Error("Completed turn still animating");
	if (await page.locator(".codex-thinking-wave").count())
		throw Error("Completed heading still animating");
	await page.getByRole("button", { name: /Worked for 38s/ }).click();
	await page.waitForTimeout(350);
	if (
		!(await page
			.getByText(
				"The sidebar now opens with the tool chooser. All checks passed.",
			)
			.isVisible())
	)
		throw Error("Collapsed work hid final answer");
	if (await page.locator(".codex-action-trigger").count())
		throw Error("Collapse did not unmount activity");
	await page.getByRole("button", { name: /Worked for 38s/ }).click();
	await page.getByRole("button", { name: /Ran rg -n toggleRight/ }).click();
	await page
		.getByText("tool-panel-store.ts:124 toggleRight()", { exact: true })
		.waitFor();
	await page.getByRole("button", { name: /Edited 1 file/ }).click();
	await page.getByText("+ showToolChooser()", { exact: false }).waitFor();
	await page.getByRole("button", { name: /Viewed a browser image/ }).click();
	await page.getByRole("button", { name: "Expand captured image" }).click();
	if (
		(await page
			.getByRole("button", { name: "Expand captured image" })
			.getAttribute("aria-expanded")) !== "true"
	)
		throw Error("Image did not expand");
	checks.push(
		"completion stops live motion; collapse retains final answer; output/diff/captured image expand",
	);
	await page.waitForTimeout(400);
	await page.screenshot({ path: resolve(output, "desktop-details.png") });
	await update({
		status: "working",
		turnId: "desktop-turn",
		approvals: [
			{
				id: "test",
				method: "item/commandExecution/requestApproval",
				title: "Approval needed",
				detail: "Run verification?",
				questions: [],
			},
		],
	});
	await page.getByText("Waiting for your response", { exact: true }).waitFor();
	await page.getByText("Run verification?", { exact: true }).waitFor();
	checks.push("approval remains actionable alongside activity");
	await update({
		status: "idle",
		turnId: null,
		approvals: [],
		items: items.map((i) =>
			i.id === "tests"
				? { ...i, status: "failed", exitCode: 1, text: "Test failed: timeout" }
				: i,
		),
		turns: [{ id: "desktop-turn", status: "failed", durationMs: 23000 }],
	});
	await page.getByRole("button", { name: /Ran bun test Failed/ }).click();
	await page.getByText("Test failed: timeout", { exact: true }).waitFor();
	checks.push(
		"failed command keeps selectable output and explicit failure status",
	);
	const longItems = Array.from({ length: 18 }, (_, i) => ({
		...base,
		id: `history-${i}`,
		turnId: `history-${i}`,
		kind: "assistant",
		title: "",
		text: `Historical response ${i}. `.repeat(12),
	}));
	await update({
		status: "working",
		turnId: "desktop-turn",
		items: [...longItems, ...items],
	});
	await page.getByRole("button", { name: "Jump to latest message" }).click();
	const scroller = page.locator(".codex-transcript-scroll");
	await scroller.hover();
	await page.mouse.wheel(0, -650);
	await page.waitForTimeout(250);
	const before = await scroller.evaluate((el: HTMLElement) => el.scrollTop);
	await update({
		items: [
			...longItems,
			...items.map((i) =>
				i.id === "tests" ? { ...i, text: "New output\n".repeat(30) } : i,
			),
		],
	});
	await page.waitForTimeout(400);
	const after = await scroller.evaluate((el: HTMLElement) => el.scrollTop);
	if (Math.abs(after - before) > 3)
		throw Error(`Stream stole scroll position: ${before} -> ${after}`);
	checks.push(
		"reading earlier messages is not interrupted by streaming output",
	);
	await heading.scrollIntoViewIfNeeded();
	await page.waitForFunction(
		() =>
			document
				.querySelector(".codex-work-heading.is-working")
				?.getAttribute("data-motion") === "running",
	);
	await scroller.evaluate((el: HTMLElement) => {
		el.scrollTop = 0;
	});
	await page.waitForFunction(
		() =>
			document
				.querySelector(".codex-work-heading.is-working")
				?.getAttribute("data-motion") === "paused",
	);
	checks.push("off-screen thinking pauses motion and its clock");
	await page.getByRole("button", { name: "Jump to latest message" }).click();
	for (const width of [820, 440]) {
		await page.setViewportSize({ width, height: 950 });
		await page.waitForTimeout(350);
		if (
			!(await page.evaluate(
				() => document.documentElement.scrollWidth <= innerWidth,
			))
		)
			throw Error(`Overflow at ${width}`);
		await page.screenshot({ path: resolve(output, `desktop-${width}.png`) });
	}
	await page.emulateMedia({ reducedMotion: "reduce" });
	await page.waitForTimeout(100);
	if (
		(await page
			.locator(".codex-thinking-wave i")
			.first()
			.evaluate((e: HTMLElement) => getComputedStyle(e).animationName)) !==
		"none"
	)
		throw Error("Reduced motion ignored");
	checks.push("narrow pane layouts and reduced motion pass");
	await page.goto(`http://127.0.0.1:${port}/?usage`);
	await page.getByText("25%", { exact: true }).waitFor();
	await page.getByText("week", { exact: true }).waitFor();
	if (await page.getByText(/usage unavailable/).count())
		throw Error("Weekly-only plan still unavailable");
	await page.getByText("25%", { exact: true }).hover();
	await page
		.getByRole("tooltip")
		.filter({ hasText: "25% of the weekly window used" })
		.waitFor();
	await page.mouse.move(0, 0);
	await page.screenshot({ path: resolve(output, "weekly-usage.png") });
	await page.evaluate(() =>
		(window as unknown as { setUsageWindow(n: number): void }).setUsageWindow(
			300,
		),
	);
	await page.getByText("5h", { exact: true }).waitFor();
	await page.evaluate(() =>
		(
			window as unknown as { setUsageProvider(p: string): void }
		).setUsageProvider("claude"),
	);
	await page.getByText("54%", { exact: true }).waitFor();
	await page.evaluate(() =>
		(
			window as unknown as { setUsageProvider(p: string): void }
		).setUsageProvider("codex"),
	);
	await page.getByText("25%", { exact: true }).waitFor();
	await page.evaluate(() =>
		(window as unknown as { setUsageWindow(n: number): void }).setUsageWindow(
			0,
		),
	);
	await page.getByText("Codex usage unavailable", { exact: true }).waitFor();
	if (await page.getByText("0%", { exact: true }).count())
		throw Error("Unknown quota shown as zero");
	checks.push(
		"sidebar shows weekly-only quotas, five-hour quotas and focused-provider changes without fabricating unknown usage",
	);
	if (errors.length) throw Error(errors.join("\n"));
	await writeFile(
		resolve(output, "results.json"),
		JSON.stringify({ ok: true, checks, errors }, null, 2),
	);
	console.log(JSON.stringify({ ok: true, checks }));
} finally {
	await browser.close();
	server.closeAllConnections();
	server.close();
}
