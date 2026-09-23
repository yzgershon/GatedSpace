/** Real production Codex components in an isolated browser, with deterministic IPC fixtures. */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { build } from "vite";
import { navigatorCodexItems } from "./codex-session/navigator-fixture.ts";

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
	`<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/style.css?v=${Date.now()}"></head><body><script src="/renderer.js?v=${Date.now()}"></script></body></html>`,
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
console.log("Activity fixture browser launched");
const checks: string[] = [];
const errors: string[] = [];
const page = await browser.newPage({
	viewport: { width: 1400, height: 1000 },
	deviceScaleFactor: 1.5,
});
try {
	page.setDefaultTimeout(15000);
	page.on("pageerror", (e) => errors.push(e.message));
	await page.goto(`http://127.0.0.1:${port}/?paired`);
	console.log("Activity fixture loaded");
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
	await heading
		.locator("[aria-live]")
		.getByText("Thinking", { exact: true })
		.waitFor();
	await page.waitForTimeout(200);
	const word = page.locator(".codex-activity-word").last();
	if (
		(await word.evaluate((el) => getComputedStyle(el).animationName)) !==
		"codex-word-sheen"
	)
		throw Error("Animated status text missing");
	if (await page.locator(".codex-thinking-wave").count())
		throw Error("Obsolete wave icon remains");
	const elapsedStart = await heading
		.locator(".codex-work-elapsed")
		.boundingBox();
	await page.waitForTimeout(3600);
	await word.getByText("Considering", { exact: true }).waitFor();
	const elapsedEnd = await heading.locator(".codex-work-elapsed").boundingBox();
	if (
		!elapsedStart ||
		!elapsedEnd ||
		Math.abs(elapsedStart.x - elapsedEnd.x) > 1
	)
		throw Error("Status word rotation shifts elapsed time");
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
	if (await page.locator(".codex-activity-words").count())
		throw Error("Waiting state still animates");
	await update({
		approvals: [],
		status: "idle",
		turnId: null,
		turns: [{ id: "thinking", status: "interrupted", durationMs: 2000 }],
	});
	await heading.getByText("Stopped", { exact: true }).waitFor();
	if (await page.locator(".codex-activity-words").count())
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
			command:
				'"C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -Command "bun test"',
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
	await heading
		.locator("[aria-live]")
		.getByText("Running commands", { exact: true })
		.waitFor();
	if (await page.locator(".codex-action-trigger").count())
		throw Error("Tool groups must start collapsed during work");
	await page.locator(".codex-group-heading").last().click();
	await page.getByRole("button", { name: /Running bun test/ }).click();
	await heading
		.locator("[aria-live]")
		.getByText("Running commands", { exact: true })
		.waitFor();
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
	await page.getByRole("button", { name: /7 previous messages/ }).waitFor();
	await page.waitForTimeout(400);
	if (await page.locator(".codex-action-trigger").count())
		throw Error("Completion did not automatically fold task work");
	await page.getByRole("button", { name: "Review", exact: true }).click();
	const reviewPanel = page.getByRole("region", { name: "Task changes" });
	await reviewPanel.getByText("ToolPanel.tsx", { exact: true }).waitFor();
	await reviewPanel.getByText("showToolChooser()", { exact: false }).waitFor();
	await page.screenshot({ path: resolve(output, "task-review.png") });
	await page.getByRole("button", { name: "Close review" }).click();
	checks.push(
		"completed task auto-collapses and its edited-file card opens the recorded diff in the review sidebar",
	);
	if (await page.locator(".codex-action-motion").count())
		throw Error("Completed turn still animating");
	if (await page.locator(".codex-activity-words").count())
		throw Error("Completed heading still animating");
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
	await page.getByRole("button", { name: /7 previous messages/ }).click();
	if (await page.locator(".codex-action-trigger").count())
		throw Error("Expanded task should keep its tool groups collapsed");
	for (const group of await page.locator(".codex-group-heading").all())
		await group.click();
	await page.getByRole("button", { name: /Ran bun test/ }).click();
	await page.getByText("12 pass · 0 fail", { exact: true }).waitFor();
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
	await page.getByRole("button", { name: /Run failed/ }).waitFor();
	await page.locator(".codex-work-body").waitFor({ state: "detached" });
	await page.getByRole("button", { name: /Run failed/ }).click();
	await page.locator(".codex-group-heading").last().click();
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
	const scroller = page.locator(".codex-transcript-scroll");
	// Establish the same user scroll state with either fixture or packaged CSS.
	// A content resize alone need not expose the jump button when already at the end.
	await scroller.evaluate((el: HTMLElement) => {
		el.scrollTop = el.scrollHeight;
	});
	await scroller.hover();
	await page.mouse.wheel(0, -300);
	await page.getByRole("button", { name: "Jump to latest message" }).click();
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
	const activityBounds = await heading.boundingBox();
	const viewportBounds = await scroller.boundingBox();
	if (
		!activityBounds ||
		!viewportBounds ||
		activityBounds.y < viewportBounds.y + viewportBounds.height
	)
		throw Error("Thinking did not scroll away with its task");
	if (await page.locator(".codex-live-footer").count())
		throw Error("Fixed activity footer remains");
	checks.push(
		"activity follows the newest content in the scroller and pauses offscreen",
	);

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

	await page.setViewportSize({ width: 1400, height: 1000 });
	const longPrompt = Array.from(
		{ length: 14 },
		(_, i) =>
			`Requested change ${i + 1}: preserve the active workspace and make every detail clear.`,
	).join("\n");
	const image =
		"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
	const oldPrompt = {
		...base,
		id: "older-prompt",
		turnId: "older-task",
		kind: "user",
		title: "",
		text: "Earlier task: verify the workspace layout and preserve my browser tabs.",
	};
	const oldResponse = {
		...base,
		id: "older-response",
		turnId: "older-task",
		kind: "assistant",
		title: "",
		text: "Earlier task response. ".repeat(500),
	};
	const currentPrompt = {
		...base,
		id: "sticky",
		kind: "user",
		title: "",
		text: longPrompt,
		images: [image, image, image],
	};
	const currentResponse = {
		...base,
		id: "live-answer",
		kind: "assistant",
		title: "",
		status: "inProgress",
		phase: "final_answer",
		text: "Current response. ".repeat(400),
	};
	const scrollItems = [
		oldPrompt,
		oldResponse,
		currentPrompt,
		...items.filter((i) => i.kind !== "user"),
		currentResponse,
	];
	await update({
		items: scrollItems,
		turns: [{ id: "desktop-turn", status: "inProgress" }],
		approvals: [],
	});
	await scroller.evaluate((el: HTMLElement) => {
		el.scrollTop = el.scrollHeight;
	});
	const pinned = page.locator(".codex-pinned-prompt");
	await page.waitForFunction(
		() =>
			document
				.querySelector("[data-pinned-id]")
				?.getAttribute("data-pinned-id") === "sticky",
	);
	if ((await page.locator("[data-prompt-id='sticky']").count()) !== 1)
		throw Error("Latest prompt missing from conversation flow");
	const promptMetrics = await pinned
		.locator(".codex-pinned-text")
		.evaluate((el: HTMLElement) => ({
			height: el.clientHeight,
			scroll: el.scrollHeight,
			mask: getComputedStyle(el).maskImage,
		}));
	if (
		promptMetrics.height !== 40 ||
		promptMetrics.scroll < 200 ||
		promptMetrics.mask === "none"
	)
		throw Error(
			`Sticky prompt did not cap to one clear line and a fading second: ${JSON.stringify(promptMetrics)}`,
		);
	const imageBounds = await pinned
		.locator(".session-image-tile")
		.first()
		.boundingBox();
	const textBounds = await pinned.locator(".codex-pinned-text").boundingBox();
	if (
		!imageBounds ||
		!textBounds ||
		imageBounds.height !== 28 ||
		imageBounds.width !== 28 ||
		imageBounds.x >= textBounds.x ||
		Math.abs(imageBounds.y - textBounds.y) > 2
	)
		throw Error("Pinned thumbnail is not compact and beside text");
	await pinned
		.getByRole("button", { name: /Preview/ })
		.first()
		.click();
	await page.getByRole("dialog").waitFor();
	await page.keyboard.press("Escape");
	await pinned.getByRole("button", { name: "Show all 3 images" }).click();
	if ((await pinned.locator(".session-image-tile").count()) !== 3)
		throw Error("Hidden image thumbnails inaccessible");
	await pinned.getByRole("button", { name: "Collapse pinned prompt" }).click();
	await pinned.getByRole("button", { name: "Expand pinned prompt" }).click();
	if ((await pinned.getAttribute("data-expanded")) !== "true")
		throw Error("Sticky prompt did not expand");
	await pinned.getByRole("button", { name: "Collapse pinned prompt" }).click();
	if (await page.getByRole("button", { name: "Review", exact: true }).count())
		throw Error("Review appeared during the task");
	await page.screenshot({ path: resolve(output, "sticky-images.png") });
	const liveBounds = await heading.boundingBox();
	const answerBounds = await page
		.locator(".codex-turn")
		.last()
		.locator(".codex-assistant-message")
		.last()
		.boundingBox();
	if (
		!liveBounds ||
		!answerBounds ||
		liveBounds.y < answerBounds.y + answerBounds.height
	)
		throw Error("Thinking is above the latest streamed answer");
	// Position the latest original at the viewport's top. The previous task ends above it.
	await scroller.evaluate((el: HTMLElement) => {
		const prompt = el.querySelector<HTMLElement>("[data-prompt-id='sticky']");
		if (!prompt) throw Error("Prompt missing");
		el.dispatchEvent(new WheelEvent("wheel", { deltaY: -1, bubbles: true }));
		el.scrollTop +=
			prompt.getBoundingClientRect().top - el.getBoundingClientRect().top;
	});
	await pinned.waitFor({ state: "detached" });
	const original = page.locator("[data-prompt-id='sticky']");
	const originalImage = await original
		.locator(".session-image-tile")
		.first()
		.boundingBox();
	const originalText = await original.locator("p").boundingBox();
	if (
		!originalImage ||
		!originalText ||
		originalImage.y + originalImage.height > originalText.y
	)
		throw Error("Original images should precede prompt text");
	await page.screenshot({ path: resolve(output, "original-prompt.png") });
	// Scroll backwards into the earlier task: sticky context must change, with no layout jump.
	await scroller.evaluate((el: HTMLElement) => {
		const prompt = el.querySelector<HTMLElement>(
			"[data-prompt-id='older-prompt']",
		);
		if (!prompt) throw Error("Earlier prompt missing");
		el.scrollTop +=
			prompt.getBoundingClientRect().bottom -
			el.getBoundingClientRect().top +
			100;
	});
	await page.waitForFunction(
		() =>
			document
				.querySelector("[data-pinned-id]")
				?.getAttribute("data-pinned-id") === "older-prompt",
	);
	const readingPosition = await scroller.evaluate(
		(el: HTMLElement) => el.scrollTop,
	);
	await update({
		items: [
			...scrollItems,
			{
				...base,
				id: "new-comment",
				kind: "assistant",
				phase: "commentary",
				title: "",
				text: "Another progress update arrived.",
			},
		],
	});
	await page.waitForTimeout(450);
	if (
		Math.abs(
			(await scroller.evaluate((el: HTMLElement) => el.scrollTop)) -
				readingPosition,
		) > 2
	)
		throw Error("Stream/pin changed reading position");
	if ((await pinned.getAttribute("data-pinned-id")) !== "older-prompt")
		throw Error("New work replaced historical sticky context");
	await page.screenshot({ path: resolve(output, "older-context.png") });
	await scroller.evaluate((el: HTMLElement) => {
		el.scrollTop = 0;
	});
	await pinned.waitFor({ state: "detached" });
	// A newly sent prompt and its activity remain inline, without premature duplication.
	await update({
		items: [currentPrompt],
		turns: [{ id: "desktop-turn", status: "inProgress" }],
	});
	await scroller.evaluate((el: HTMLElement) => {
		el.scrollTop = 0;
	});
	await pinned.waitFor({ state: "detached" });
	await original.waitFor();
	await page.screenshot({ path: resolve(output, "fresh-prompt.png") });
	checks.push(
		"original prompts stay inline; sticky follows scroll context only after originals leave, with 28px images and one clear line plus fade; live activity follows streamed answers",
	);
	// Sending from an older scroll position should reveal the optimistic prompt immediately.
	await update({
		items: [
			...scrollItems,
			{
				...base,
				id: "local-user-next",
				turnId: "next",
				kind: "user",
				title: "",
				text: "Please check the next task.",
			},
		],
		turnId: "next",
	});
	await page.waitForTimeout(400);
	const sentBounds = await page
		.locator("[data-prompt-id='local-user-next']")
		.boundingBox();
	const sentViewport = await scroller.boundingBox();
	if (
		!sentBounds ||
		!sentViewport ||
		sentBounds.y < sentViewport.y ||
		sentBounds.y + sentBounds.height > sentViewport.y + sentViewport.height
	)
		throw Error("Newly sent prompt was not brought into view");
	if (await page.locator("[data-pinned-id='local-user-next']").count())
		throw Error("New visible prompt was duplicated in the sticky card");
	checks.push(
		"sending while reading history reveals the optimistic prompt without a sticky duplicate",
	);
	await update({ items: scrollItems, turnId: "desktop-turn" });
	await scroller.evaluate((el: HTMLElement) => {
		el.scrollTop = el.scrollHeight;
	});
	const question = {
		id: "question-one",
		method: "item/tool/requestUserInput",
		title: "Codex needs your input",
		detail: "",
		isBlocking: false,
		questions: [
			{
				id: "panels",
				question: "Are both panels closed?",
				options: ["Both panels are closed now", "Keep them open"],
			},
		],
	};
	await update({ approvals: [question] });
	await heading
		.locator("[aria-live]")
		.getByText("Running commands", { exact: true })
		.waitFor();
	await scroller.evaluate((el: HTMLElement) => {
		el.scrollTop = 0;
	});
	await page
		.getByRole("button", { name: /Both panels are closed now/ })
		.click();
	await page.locator(".codex-question-card").waitFor({ state: "detached" });
	let replies = await page.evaluate(
		() =>
			(
				window as unknown as {
					submittedAnswers: Array<{ answers: Record<string, string> }>;
				}
			).submittedAnswers,
	);
	if (
		replies.length !== 1 ||
		replies[0].answers.panels !== "Both panels are closed now"
	)
		throw Error("Choice was not submitted automatically");
	await update({ approvals: [{ ...question, id: "question-two" }] });
	await page.getByRole("button", { name: /Other/ }).click();
	await page
		.getByRole("textbox", { name: "Your answer: Are both panels closed?" })
		.fill("Only the browser is open");
	await page.screenshot({ path: resolve(output, "async-question.png") });
	await page
		.getByRole("textbox", { name: "Your answer: Are both panels closed?" })
		.press("Enter");
	await page.locator(".codex-question-card").waitFor({ state: "detached" });
	replies = await page.evaluate(
		() =>
			(
				window as unknown as {
					submittedAnswers: Array<{ answers: Record<string, string> }>;
				}
			).submittedAnswers,
	);
	if (
		replies.length !== 2 ||
		replies[1].answers.panels !== "Only the browser is open"
	)
		throw Error("Custom answer not delivered once");
	checks.push(
		"async question remains visible during work; choice auto-submits and Other sends a custom response",
	);

	await page.emulateMedia({ reducedMotion: "reduce" });
	await page.waitForTimeout(100);
	if (
		(await page
			.locator(".codex-activity-word")
			.last()
			.evaluate((e: HTMLElement) => getComputedStyle(e).animationName)) !==
		"none"
	)
		throw Error("Reduced motion ignored");
	checks.push("narrow pane layouts and reduced motion pass");
	await page.setViewportSize({ width: 1400, height: 950 });
	await page.goto(`http://127.0.0.1:${port}/?paired`);
	await page.getByRole("textbox", { name: "Message Codex" }).waitFor();
	await page.evaluate(() =>
		(
			window as unknown as { codexLayout: { split(): void } }
		).codexLayout.split(),
	);
	await page.waitForTimeout(400);
	const composers = page.locator(".session-composer");
	if ((await composers.count()) !== 2) throw Error("Both composers missing");
	for (const composer of await composers.all()) {
		await composer
			.locator("textarea:not([aria-hidden])")
			.evaluate(async (target) => {
				const canvas = document.createElement("canvas");
				canvas.width = 640;
				canvas.height = 360;
				const ctx = canvas.getContext("2d");
				if (!ctx) throw Error("Canvas context unavailable");
				ctx.fillStyle = "#282a36";
				ctx.fillRect(0, 0, 640, 360);
				ctx.fillStyle = "#bd93f9";
				ctx.font = "32px sans-serif";
				ctx.fillText("Workspace preview", 40, 90);
				ctx.fillStyle = "#f8f8f2";
				ctx.fillRect(40, 130, 560, 170);
				const blob = await new Promise<Blob>((done, reject) =>
					canvas.toBlob(
						(b) => (b ? done(b) : reject(Error("No image"))),
						"image/png",
					),
				);
				const transfer = new DataTransfer();
				transfer.items.add(
					new File([blob], "workspace.png", { type: "image/png" }),
				);
				target.dispatchEvent(
					new ClipboardEvent("paste", {
						bubbles: true,
						cancelable: true,
						clipboardData: transfer,
					}),
				);
			});
		await composer.getByRole("button", { name: /Preview/ }).waitFor();
		if (
			(await composer.evaluate((e) =>
				parseFloat(getComputedStyle(e).borderTopWidth),
			)) < 1.3
		)
			throw Error("Composer outline too thin");
		if (
			(await composer
				.locator(".session-image-preview img")
				.evaluate((e) => getComputedStyle(e).objectFit)) !== "contain"
		)
			throw Error("Pasted thumbnail is cropped");
		await composer.getByRole("button", { name: /Preview/ }).click();
		const dialog = page.getByRole("dialog");
		await dialog.waitFor();
		const imageBox = await dialog.locator("img").boundingBox();
		if (!imageBox || imageBox.width < 500 || imageBox.height < 250)
			throw Error("Full image preview is not readable");
		await page.keyboard.press("Escape");
		await dialog.waitFor({ state: "hidden" });
	}
	await page.screenshot({ path: resolve(output, "composer-images.png") });
	await page.setViewportSize({ width: 820, height: 950 });
	await page.waitForTimeout(350);
	if (
		!(await page.evaluate(
			() => document.documentElement.scrollWidth <= innerWidth,
		))
	)
		throw Error("Image previews overflow narrow panes");
	for (const composer of await composers.all()) {
		await composer.getByRole("button", { name: /Remove/ }).click();
		if (await composer.locator(".session-image-tile").count())
			throw Error("Remove image failed");
	}
	checks.push(
		"both composers paste uncropped thumbnails, open full-size previews, dismiss with Escape and remove images; stronger borders and narrow panes pass",
	);
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
	await page.setViewportSize({ width: 1100, height: 900 });
	await page.emulateMedia({ reducedMotion: "no-preference" });
	await page.goto(`http://127.0.0.1:${port}/?paired&navigator`);
	await page.getByRole("textbox", { name: "Message Codex" }).waitFor();
	const rail = page.getByRole("navigation", { name: "Prompt history" });
	const marks = rail.locator(".prompt-navigator-mark");
	await marks.nth(5).waitFor();
	if ((await marks.count()) !== 6)
		throw Error("Prompt rail does not match sent messages");
	await marks.nth(2).hover();
	await rail.getByRole("tooltip").waitFor();
	if (
		!(await rail.getByRole("tooltip").textContent())?.includes(
			"Live activity follows",
		)
	)
		throw Error("Prompt preview is missing its reply");
	await page.screenshot({ path: resolve(output, "prompt-navigator.png") });
	const viewport = page.locator(".codex-transcript-scroll");
	const landed = async (id: string) => {
		await page.waitForFunction((promptId) => {
			const el = document.querySelector(".codex-transcript-scroll");
			const target = Array.from(
				el?.querySelectorAll<HTMLElement>("[data-prompt-id]") ?? [],
			).find((p) => p.dataset.promptId === promptId);
			if (!el || !target) return false;
			const offset =
				target.getBoundingClientRect().top - el.getBoundingClientRect().top;
			return (
				offset >= 0 &&
				(Math.abs(offset - 16) < 1.5 ||
					(el.scrollHeight - el.scrollTop - el.clientHeight < 2 &&
						offset < el.clientHeight) ||
					(el.scrollTop === 0 && offset < 50))
			);
		}, id);
	};
	await marks.nth(2).click();
	await landed("nav-prompt-2");
	await page.waitForTimeout(100);
	if (await page.locator(".codex-prompt-overlay").count())
		throw Error("Older sticky prompt covers the navigation destination");
	if ((await marks.nth(2).getAttribute("aria-current")) !== "location")
		throw Error("Reading position did not update the current mark");
	const beforeStream = await viewport.evaluate((el) => el.scrollTop);
	await update({
		items: [
			...navigatorCodexItems,
			{
				id: "nav-stream",
				turnId: "nav-turn-5",
				kind: "assistant",
				title: "",
				text: "A new update. ".repeat(200),
			},
		],
		status: "working",
		turnId: "nav-turn-5",
	});
	await page.waitForTimeout(350);
	if (
		Math.abs((await viewport.evaluate((el) => el.scrollTop)) - beforeStream) > 3
	)
		throw Error(
			`Streaming changed navigation position: ${beforeStream} -> ${await viewport.evaluate((el) => el.scrollTop)}`,
		);
	await page.keyboard.press("ArrowUp");
	await page.keyboard.press("Enter");
	await landed("nav-prompt-1");
	await page.keyboard.press("Escape");
	await rail.getByRole("tooltip").waitFor({ state: "hidden" });
	await viewport.hover();
	await page.mouse.wheel(0, 200);
	await page.waitForTimeout(350);
	if ((await marks.nth(1).getAttribute("aria-current")) !== "location")
		throw Error("Manual scrolling lost the active task");
	checks.push(
		"Codex prompt marks preview replies, jump to originals, track scrolling, support keyboard navigation, and preserve position during streaming",
	);
	await update({ historyCursor: "older" });
	await rail.getByRole("button", { name: "Load earlier prompts" }).click();
	await rail
		.getByRole("button", {
			name: /Go to prompt 1: Earlier conversation restored/,
		})
		.waitFor();
	await rail
		.getByRole("button", { name: "Load earlier prompts" })
		.waitFor({ state: "hidden" });
	checks.push(
		"Older history is reachable from the rail and adds its prompt without replacing existing entries",
	);
	const manyPrompts = Array.from({ length: 80 }, (_, i) => [
		{
			...navigatorCodexItems[0],
			id: `many-${i}`,
			turnId: `many-turn-${i}`,
			text: `History prompt ${i + 1}`,
		},
		{
			...navigatorCodexItems[1],
			id: `many-reply-${i}`,
			turnId: `many-turn-${i}`,
			text: "A short response with a useful result.",
		},
	]).flat();
	await update({ items: manyPrompts, status: "idle", turnId: null });
	await page.setViewportSize({ width: 410, height: 700 });
	await page.emulateMedia({ reducedMotion: "reduce" });
	await marks.first().focus();
	await page.keyboard.press("End");
	await page.keyboard.press("Enter");
	await landed("many-79");
	await marks.last().hover();
	const previewBox = await rail.getByRole("tooltip").boundingBox();
	if (!previewBox || previewBox.x < 0 || previewBox.x + previewBox.width > 410)
		throw Error("Narrow prompt preview is clipped");
	if (
		(await rail
			.getByRole("tooltip")
			.evaluate((el) => getComputedStyle(el).animationName)) !== "none"
	)
		throw Error("Prompt rail ignores reduced motion");
	const railOverflow = await rail
		.locator(".prompt-navigator-list")
		.evaluate((el) => ({ height: el.clientHeight, total: el.scrollHeight }));
	if (railOverflow.total <= railOverflow.height)
		throw Error("Long prompt history was not bounded");
	await page.screenshot({
		path: resolve(output, "prompt-navigator-narrow.png"),
	});
	await page.keyboard.press("Home");
	await page.keyboard.press("Enter");
	await landed("many-0");
	await page.keyboard.press("Escape");
	checks.push(
		"An 80-prompt rail stays bounded in a narrow pane; Home/End reach both ends and reduced motion disables animation",
	);
	await page.setViewportSize({ width: 1100, height: 900 });
	await page.goto(`http://127.0.0.1:${port}/?paired&navigator`);
	await page.getByRole("textbox", { name: "Message Codex" }).waitFor();
	await page.evaluate(() =>
		(
			window as unknown as { codexLayout: { split(): void } }
		).codexLayout.split(),
	);
	await page.getByRole("textbox", { name: "Message Claude" }).waitFor();
	if (
		(await page.getByRole("navigation", { name: "Prompt history" }).count()) !==
		1
	)
		throw Error("Navigator leaked into Claude pane");
	checks.push(
		"Navigator is available only in Codex; Claude panes remain unchanged",
	);
	if (errors.length) throw Error(errors.join("\n"));
	await writeFile(
		resolve(output, "results.json"),
		JSON.stringify({ ok: true, checks, errors }, null, 2),
	);
	console.log(JSON.stringify({ ok: true, checks }));
} catch (error) {
	console.error("Activity fixture failed", error);
	console.error(
		await page
			.locator(".codex-work-heading")
			.evaluateAll((els) => els.map((el) => el.outerHTML)),
	);
	await page.screenshot({ path: resolve(output, "failure.png") });
	throw error;
} finally {
	await browser.close();
	server.closeAllConnections();
	server.close();
}
