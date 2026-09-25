/** Real production Codex components in an isolated browser, with deterministic IPC fixtures. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { build } from "vite";

// Set PLAYWRIGHT_MODULE when using an existing tool runtime instead of a local install.
const { chromium } = await import(
	process.env.PLAYWRIGHT_MODULE ?? "playwright"
);

const output = resolve(
	import.meta.dirname,
	"../../../.tmp/codex-native-audit/ui",
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
async function checkComputerControl(
	page: Awaited<ReturnType<typeof browser.newPage>>,
) {
	await page.goto(`http://127.0.0.1:${port}/?paired`);
	await page
		.getByRole("button", { name: "Computer control", exact: true })
		.click();
	await page
		.getByRole("button", { name: "Enable for this pane", exact: true })
		.click();
	await page.getByText("Enabled for this pane", { exact: true }).waitFor();
	await page.keyboard.press("Escape");
	await page.locator(".computer-control-panel").waitFor({ state: "detached" });
	await page.getByText("Computer ready", { exact: true }).waitFor();
	await page
		.getByRole("button", { name: "Stop computer control", exact: true })
		.click();
	await page
		.getByText("Computer ready", { exact: true })
		.waitFor({ state: "detached" });
	checks.push(
		"computer-control toggle and persistent Stop button work with real production UI",
	);
	await page.setViewportSize({ width: 380, height: 800 });
	await page
		.getByRole("button", { name: "Computer control", exact: true })
		.click();
	const controlBounds = await page
		.locator(".computer-control-panel")
		.boundingBox();
	if (
		!controlBounds ||
		controlBounds.x < 0 ||
		controlBounds.x + controlBounds.width > 380
	)
		throw Error("Computer controls are clipped in a narrow pane");
	await page.screenshot({
		path: resolve(output, "computer-control-narrow.png"),
	});
	await page
		.getByRole("button", { name: "Enable for this pane", exact: true })
		.click();
	await page.keyboard.press("Escape");
	await page.locator(".computer-control-panel").waitFor({ state: "detached" });
	const stopBounds = await page
		.getByRole("button", { name: "Stop computer control", exact: true })
		.boundingBox();
	if (!stopBounds || stopBounds.x < 0 || stopBounds.x + stopBounds.width > 380)
		throw Error("Stop is clipped");
	await page
		.getByRole("button", { name: "Stop computer control", exact: true })
		.click();
	checks.push("computer enable menu and Stop remain accessible at 380px");
	await page.setViewportSize({ width: 1440, height: 1000 });
}
try {
	const page = await browser.newPage({
		viewport: { width: 1440, height: 1000 },
		deviceScaleFactor: 1.5,
	});
	page.on("pageerror", (e) => {
		errors.push(e.message);
		console.error("Browser error:", e.message);
	});
	await page.goto(`http://127.0.0.1:${port}`);
	await page.getByRole("textbox", { name: "Message Codex" }).waitFor();
	await page
		.getByText("The panels now reopen exactly where you left them.")
		.waitFor();
	checks.push("saved transcript renders");
	async function checkPaneLayout(name: string) {
		const geometry = await page
			.locator(".codex-native")
			.evaluate((root: HTMLElement) => {
				const pane = root.parentElement?.getBoundingClientRect();
				const view = root.getBoundingClientRect();
				const composer = root
					.querySelector("textarea")
					?.getBoundingClientRect();
				if (!pane || !composer) throw Error("Missing pane or composer");
				return {
					paneWidth: pane.width,
					viewWidth: view.width,
					composerWidth: composer.width,
					composerHeight: composer.height,
					bottom: composer.bottom,
					paneBottom: pane.bottom,
				};
			});
		if (
			geometry.viewWidth < geometry.paneWidth - 2 ||
			geometry.composerWidth < Math.min(200, geometry.paneWidth / 2) ||
			geometry.composerHeight < 30 ||
			geometry.bottom > geometry.paneBottom + 1
		)
			throw Error(
				`${name}: collapsed or clipped Codex view ${JSON.stringify(geometry)}`,
			);
		checks.push(name);
	}
	if (process.env.COMPUTER_CONTROL_ONLY === "1") {
		await checkComputerControl(page);
		if (errors.length) throw Error(errors.join("\n"));
		const result = { ok: true, checks, errors };
		await writeFile(
			resolve(output, "computer-results.json"),
			JSON.stringify(result, null, 2),
		);
		console.log(JSON.stringify(result));
		await browser.close();
		server.closeAllConnections();
		server.close();
		process.exit(0);
	}
	await checkPaneLayout("production pane fills its content wrapper");
	const theme = await page.evaluate(() =>
		getComputedStyle(document.documentElement)
			.getPropertyValue("--background")
			.trim(),
	);
	if (theme !== "#282a36") throw Error(`Expected Dracula, received ${theme}`);
	checks.push("Dracula theme tokens");
	await page.screenshot({ path: resolve(output, "dracula-conversation.png") });
	await page.getByRole("button", { name: "Load earlier messages" }).click();
	await page.getByText("Earlier conversation restored.").waitFor();
	checks.push("history paging");
	const input = page.getByRole("textbox", { name: "Message Codex" });
	await input.fill("Check the panel animations");
	await page.getByRole("button", { name: "Send message", exact: true }).click();
	await page.getByText("Done. Your workspace layout is preserved.").waitFor();
	checks.push("send and stream completion");
	await input.fill("Stop this turn");
	await input.press("Enter");
	await page.getByRole("button", { name: "Stop Codex" }).click();
	await page
		.getByRole("button", { name: "Send message", exact: true })
		.waitFor();
	checks.push("interrupt");
	await input.fill("simulate failure");
	await input.press("Enter");
	await page.getByRole("alert").waitFor();
	if ((await input.inputValue()) !== "simulate failure")
		throw Error("Failed send lost draft");
	checks.push("failed send preserves draft");
	await page.evaluate(() => {
		(
			window as unknown as { codexFixture: { approval: () => void } }
		).codexFixture.approval();
	});
	await page.getByRole("button", { name: "Allow once" }).waitFor();
	await page.screenshot({ path: resolve(output, "dracula-approval.png") });
	await page.getByRole("button", { name: "Decline", exact: true }).click();
	checks.push("inline approval");
	await input.fill("draft survives reload");
	await page.reload();
	await input.waitFor();
	if ((await input.inputValue()) !== "draft survives reload")
		throw Error("Draft not persisted");
	checks.push("draft persistence");
	await page
		.getByRole("textbox", { name: "Message Codex" })
		.fill("/effort xhigh");
	await page.getByRole("textbox", { name: "Message Codex" }).press("Enter");
	await page.getByText("Effort set to Extra High.", { exact: true }).waitFor();
	await page
		.getByRole("button", { name: "GPT-6 Astra settings", exact: true })
		.click();
	const slider = page.getByRole("slider", { name: "Reasoning effort" });
	await slider.press("Home");
	if ((await slider.getAttribute("aria-valuetext")) !== "Low")
		throw Error("Effort slider did not change");
	await page.getByRole("button", { name: "Reset effort to default" }).click();
	await slider.press("Escape");
	checks.push("shared effort slider supports keyboard and reset");
	await page.getByRole("textbox", { name: "Message Codex" }).fill("$des");
	await page.getByRole("option", { name: "$design Design this app" }).waitFor();
	await page.getByRole("textbox", { name: "Message Codex" }).press("Tab");
	if (
		(await page
			.getByRole("textbox", { name: "Message Codex" })
			.inputValue()) !== "$design "
	)
		throw Error("Skill completion lost the input");
	await page.evaluate(
		() =>
			new Promise<void>((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
			),
	);
	await page.getByRole("textbox", { name: "Message Codex" }).fill("/review");
	await page.getByRole("textbox", { name: "Message Codex" }).press("Enter");
	await page.getByText("Running review", { exact: true }).waitFor();
	checks.push("slash review runs a command and dollar skills complete");
	await page
		.getByRole("textbox", { name: "Message Codex" })
		.fill("/not-a-command");
	await page.getByRole("textbox", { name: "Message Codex" }).press("Enter");
	await page
		.getByText(
			"Unknown command /not-a-command. Type / to see available commands.",
		)
		.waitFor();
	if (
		(await page
			.getByRole("textbox", { name: "Message Codex" })
			.inputValue()) !== "/not-a-command"
	)
		throw Error("Invalid command lost the draft");
	await page.getByRole("textbox", { name: "Message Codex" }).fill("");
	checks.push("unknown commands are not sent as prompts");

	for (const width of [1440, 820, 440]) {
		await page.setViewportSize({ width, height: 950 });
		await checkPaneLayout(`single pane ${width}`);
		await page.screenshot({ path: resolve(output, `dracula-${width}.png`) });
		const overflow = await page.evaluate(
			() => document.documentElement.scrollWidth > innerWidth,
		);
		if (overflow) throw Error(`Horizontal overflow at ${width}`);
		checks.push(`responsive ${width}`);
	}
	await page.setViewportSize({ width: 1600, height: 950 });
	await page.evaluate(() =>
		(
			window as unknown as { codexLayout: { split(): void } }
		).codexLayout.split(),
	);
	for (const scale of [0.85, 1, 1.2]) {
		await page.evaluate(
			(scale: number) =>
				(
					window as unknown as { codexLayout: { zoom(scale: number): void } }
				).codexLayout.zoom(scale),
			scale,
		);
		await checkPaneLayout(`split panes at ${scale}`);
		await input.fill(`Typing in the split pane at ${scale}`);
		await page.screenshot({
			path: resolve(output, `dracula-split-${scale}.png`),
		});
	}
	await page.getByRole("button", { name: "Expand pane" }).first().click();
	await checkPaneLayout("expanded pane");
	await page.getByRole("button", { name: "Restore pane" }).click();
	await checkPaneLayout("restored split pane");
	await page.goto(`http://127.0.0.1:${port}/?paired`);
	await page.evaluate(() =>
		(
			window as unknown as { codexLayout: { split(): void } }
		).codexLayout.split(),
	);
	const claudeInput = page.getByRole("textbox", { name: "Message Claude" });
	await claudeInput.waitFor().catch(async (error: Error) => {
		await page.screenshot({ path: resolve(output, "paired-failure.png") });
		console.error(await page.locator("body").innerText());
		throw error;
	});
	await input.fill("");
	await page
		.getByText("Start a Claude Code session", { exact: true })
		.waitFor();
	const claudeBox = page
		.locator(".session-composer")
		.filter({ has: claudeInput });
	const geometry = await claudeBox.boundingBox();
	if (
		!geometry ||
		geometry.width < 300 ||
		geometry.height > 125 ||
		geometry.height < 50
	)
		throw Error(`Claude Focus composer geometry: ${JSON.stringify(geometry)}`);
	await claudeBox
		.getByRole("button", { name: "Claude Opus settings", exact: true })
		.click();
	await page
		.getByRole("slider", { name: "Reasoning effort", exact: true })
		.press("ArrowLeft");
	await page.getByRole("button", { name: "Fast mode", exact: true }).click();
	if (
		(await page
			.getByRole("button", { name: "Fast mode", exact: true })
			.getAttribute("aria-pressed")) !== "true"
	)
		throw Error("Claude Fast toggle did not apply");
	await page.screenshot({
		path: resolve(output, "claude-focus-settings.png"),
	});
	await page
		.getByRole("slider", { name: "Reasoning effort", exact: true })
		.press("Escape");
	await claudeInput.fill("/model");
	await page.getByRole("button", { name: /Opus/ }).first().waitFor();
	await claudeInput.fill("");
	await page
		.getByRole("slider", { name: "Reasoning effort", exact: true })
		.waitFor({ state: "detached" });
	await page.screenshot({
		path: resolve(output, "claude-focus-paired.png"),
	});
	for (const textbox of [input, claudeInput]) {
		const prompt = Array.from(
			{ length: 20 },
			(_, i) => `Line ${i + 1}: Keep my composer aligned.`,
		).join("\n");
		await textbox.fill(prompt);
		await textbox.press("Control+Home");
		await page.waitForTimeout(200);
		const dimensions = await textbox.evaluate((node: HTMLTextAreaElement) => ({
			height: node.clientHeight,
			line: parseFloat(getComputedStyle(node).lineHeight),
			scrollHeight: node.scrollHeight,
			fade: getComputedStyle(node).maskImage,
		}));
		if (
			Math.abs(dimensions.height / dimensions.line - 6.55) > 0.1 ||
			dimensions.scrollHeight <= dimensions.height ||
			dimensions.fade === "none"
		)
			throw Error(`Long prompt cap/fade: ${JSON.stringify(dimensions)}`);
		await textbox.press("Control+End");
		await textbox.pressSequentially(" Kept.");
		if (!(await textbox.inputValue()).endsWith(" Kept."))
			throw Error("Long prompt caret lost its position");
		await textbox.fill("");
	}
	await page
		.getByRole("button", { name: "GPT-6 Astra settings", exact: true })
		.click();
	await page.getByRole("radio", { name: /^Plan/ }).check();
	await page.getByRole("button", { name: "Fast mode", exact: true }).click();
	if (
		(await page
			.getByRole("button", { name: "Fast mode", exact: true })
			.getAttribute("aria-pressed")) !== "true"
	)
		throw Error("Fast toggle did not change");
	await page.screenshot({ path: resolve(output, "focus-paired-settings.png") });
	await page.getByRole("slider", { name: "Reasoning effort" }).press("Escape");
	checks.push(
		"Claude Focus composer, command palette and shared model/mode controls work",
		"both composers cap at six lines and fade overflow",
		"long prompt typing preserves caret",
		"Codex Focus menu and both Fast toggles work",
	);

	await page.goto(`http://127.0.0.1:${port}/?paired`);
	await input.fill("Delayed first response");
	await input.press("Enter");
	await page.getByText("Considering the next step", { exact: true }).waitFor();
	if (
		!(await page
			.getByText("Delayed first response", { exact: true })
			.isVisible())
	)
		throw Error("Sent prompt disappeared while Codex was working");
	const workingLayout = await page
		.locator(".codex-work-heading")
		.evaluate((el: HTMLElement) => ({
			top: el.getBoundingClientRect().top,
			font: parseFloat(getComputedStyle(el).fontSize),
			promptBottom:
				document.querySelector(".codex-user-message")?.getBoundingClientRect()
					.bottom ?? 0,
		}));
	if (
		workingLayout.top - workingLayout.promptBottom > 70 ||
		workingLayout.font < 14
	)
		throw Error(
			`Working indicator misplaced: ${JSON.stringify(workingLayout)}`,
		);
	await page.screenshot({ path: resolve(output, "codex-working.png") });
	await page.getByText("Done. Your workspace layout is preserved.").waitFor();
	checks.push(
		"first prompt stays visible during delayed response",
		"working indicator follows the prompt at readable size",
	);
	await page.goto(`http://127.0.0.1:${port}/?paired&inline`);
	await page.evaluate(() =>
		(
			window as unknown as { codexLayout: { split(): void } }
		).codexLayout.split(),
	);
	await page.getByRole("textbox", { name: "Message Claude" }).waitFor();
	await claudeInput.fill("");
	await input.fill("");
	await page.waitForTimeout(200);
	const cards = await page
		.locator(".session-composer")
		.evaluateAll((nodes: Element[]) =>
			nodes.map((node) => {
				const box = node.getBoundingClientRect();
				const css = getComputedStyle(node);
				return {
					height: box.height,
					bottom: box.bottom,
					radius: css.borderRadius,
					background: css.backgroundColor,
				};
			}),
		);
	if (
		cards.length !== 2 ||
		Math.abs(cards[0].height - cards[1].height) > 1 ||
		Math.abs(cards[0].bottom - cards[1].bottom) > 1 ||
		cards[0].radius !== cards[1].radius ||
		cards[0].background !== cards[1].background
	)
		throw Error(`Composers must match across skins: ${JSON.stringify(cards)}`);
	for (const [title, provider] of [
		["Codex", "Codex"],
		["Claude", "Claude Code"],
	]) {
		const pane = page
			.locator("[data-pane-id]")
			.filter({ has: page.getByRole("textbox", { name: `Message ${title}` }) });
		await pane.locator(".gs-pane-title").dblclick();
		await pane
			.getByRole("textbox", { name: "Rename pane" })
			.fill(`Renamed ${title} session with a long descriptive title`);
		await pane.getByRole("textbox", { name: "Rename pane" }).press("Enter");
		const icon = pane.locator(`img[alt="${provider}"][title]`);
		if (!(await icon.isVisible()))
			throw Error(`Missing ${provider} header icon after rename`);
		const appearance = await pane
			.locator(".gs-pane-title")
			.evaluate((node: Element) => ({
				font: getComputedStyle(node).fontFamily,
				weight: getComputedStyle(node).fontWeight,
			}));
		if (
			!appearance.font.includes("Segoe UI Variable") ||
			appearance.weight !== "600"
		)
			throw Error(`Header typography missing: ${JSON.stringify(appearance)}`);
	}
	await page.screenshot({
		path: resolve(output, "focus-matching-renamed.png"),
	});
	checks.push(
		"both providers use matching Focus surfaces and geometry across skins",
		"renamed headers retain provider icons, folder icons and refined typography",
	);

	await page.goto(`http://127.0.0.1:${port}/?paired&permission`);
	await page.evaluate(() =>
		(
			window as unknown as { codexLayout: { split: () => void } }
		).codexLayout.split(),
	);
	await page.getByRole("region", { name: "Permission request" }).waitFor();
	await page.getByText("Request details").click();
	await page
		.getByText('"url": "http://localhost:3000"', { exact: false })
		.waitFor();
	await page.screenshot({
		path: resolve(output, "claude-browser-approval.png"),
	});
	await page.getByRole("button", { name: "Allow once", exact: true }).click();
	await page
		.getByRole("region", { name: "Permission request" })
		.waitFor({ state: "detached", timeout: 5000 })
		.catch(async (error) => {
			await page.screenshot({ path: resolve(output, "approval-failure.png") });
			console.error("Approval state", await page.locator("body").innerText());
			throw error;
		});
	checks.push(
		"Claude tool permission displays details and submits an explicit approval",
	);
	await checkComputerControl(page);
	await page.goto(`http://127.0.0.1:${port}/?loading`);
	const loader = page.getByLabel("Loading workspace");
	await loader.waitFor();
	const loaderShape = await loader.evaluate((el: HTMLElement) => {
		const card = el.firstElementChild as HTMLElement;
		return {
			inset: parseFloat(getComputedStyle(el).paddingLeft),
			radius: parseFloat(getComputedStyle(card).borderRadius),
			clipping: getComputedStyle(card).overflow,
		};
	});
	if (
		loaderShape.inset !== 9 ||
		loaderShape.radius !== 8 ||
		loaderShape.clipping !== "hidden"
	)
		throw Error(
			`Incorrect loading pane geometry: ${JSON.stringify(loaderShape)}`,
		);
	await page.screenshot({ path: resolve(output, "rounded-loading.png") });
	checks.push("loading workspace respects pane inset, radius and clipping");
	if (errors.length) throw Error(errors.join("\n"));
	console.log(JSON.stringify({ ok: true, checks }));
	await writeFile(
		resolve(output, "results.json"),
		JSON.stringify({ ok: true, checks, errors }, null, 2),
	);
} finally {
	await browser.close();
	server.closeAllConnections();
	server.close();
}
