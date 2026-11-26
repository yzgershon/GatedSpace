import assert from "node:assert/strict";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import tailwind from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { build } from "vite";

const desktop = resolve(import.meta.dirname, "..");
const output = resolve(desktop, "../../.tmp/usage-recovery-preview");
await mkdir(output, { recursive: true });
const fixtureClient = resolve(
	desktop,
	"scripts/usage-recovery-preview/fixture-client.ts",
);
await build({
	configFile: false,
	envFile: false,
	root: desktop,
	logLevel: "warn",
	plugins: [
		react(),
		tailwind(),
		{
			name: "isolated-recovery",
			enforce: "pre",
			load(id) {
				if (/renderer[/\\]lib[/\\]trpc-client\.ts$/.test(id))
					return `export { electronTrpcClient } from ${JSON.stringify(fixtureClient.replaceAll("\\", "/"))};`;
			},
		},
	],
	define: { "process.env": "{}" },
	resolve: {
		alias: {
			renderer: resolve(desktop, "src/renderer"),
			shared: resolve(desktop, "src/shared"),
		},
	},
	build: {
		outDir: output,
		emptyOutDir: false,
		minify: false,
		lib: {
			entry: resolve(desktop, "scripts/usage-recovery-preview/renderer.tsx"),
			formats: ["iife"],
			name: "UsageRecoveryPreview",
			fileName: () => "renderer.js",
			cssFileName: "style",
		},
	},
});
await writeFile(
	resolve(output, "index.html"),
	'<!doctype html><html lang="en" class="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>GatedSpace · Usage recovery</title><link rel="stylesheet" href="./style.css"></head><body><div id="root"></div><script src="./renderer.js"></script></body></html>',
);
const server = createServer(async (request, response) => {
	const file =
		new URL(request.url, "http://localhost").pathname.slice(1) || "index.html";
	if (!["index.html", "renderer.js", "style.css"].includes(file))
		return response.writeHead(404).end();
	response.setHeader(
		"Content-Type",
		file.endsWith(".js")
			? "text/javascript"
			: file.endsWith(".css")
				? "text/css"
				: "text/html",
	);
	response.end(await readFile(resolve(output, file)));
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const pkgRoot = resolve(desktop, "../../node_modules/.bun");
const pkg = (await readdir(pkgRoot)).find((name) =>
	name.startsWith("playwright@"),
);
const { chromium } = await import(
	pathToFileURL(resolve(pkgRoot, pkg, "node_modules/playwright/index.mjs"))
);
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
	viewport: { width: 1080, height: 850 },
	permissions: ["clipboard-read", "clipboard-write"],
});
const page = await context.newPage();
const errors = [],
	checks = [];
page.on("pageerror", (e) => errors.push(e.message));
const reset = async () => {
	await page.evaluate(() => window.usageFixture.reset());
	await page
		.getByRole("button", { name: "Continue session", exact: true })
		.first()
		.waitFor();
};
const count = () => page.evaluate(() => window.usageFixture.calls.length);
try {
	await page.goto(`http://127.0.0.1:${server.address().port}`);
	await page.locator("#codex [data-status=error]").waitFor();
	for (const provider of ["codex", "claude"]) {
		await reset();
		const pane = page.locator(`#${provider}`);
		await pane
			.getByRole("button", { name: "Continue session", exact: true })
			.click();
		await page
			.getByText("Continue this conversation", { exact: true })
			.waitFor();
		assert.equal(await count(), 0);
		await page.getByRole("button", { name: "Cancel", exact: true }).click();
		assert.equal(await count(), 0);
		await pane
			.getByRole("button", { name: "Continue session", exact: true })
			.click();
		await page
			.getByRole("button", { name: "Continue now", exact: true })
			.click();
		await pane
			.getByText("Continuation requested in this conversation.")
			.waitFor();
		assert.deepEqual(
			await page.evaluate(() =>
				window.usageFixture.calls.map(({ provider, action }) => ({
					provider,
					action,
				})),
			),
			[{ provider, action: "continue" }],
		);
		checks.push(
			`${provider}: explanation before one continuation, cancel sends nothing`,
		);
		await reset();
		await pane
			.getByRole("button", { name: "Auto-continue at reset", exact: true })
			.click();
		await page
			.getByRole("button", { name: "Enable auto-continue", exact: true })
			.click();
		await pane
			.getByRole("button", { name: "Cancel auto-continue", exact: true })
			.click();
		assert.equal(
			await page.evaluate(
				(p) => window.usageFixture.recoveries[p].autoContinue,
				provider,
			),
			false,
		);
		checks.push(
			`${provider}: explicit opt-in and cancel through the provider route`,
		);
	}
	await reset();
	await page
		.locator("#claude")
		.getByRole("button", { name: "Continue session", exact: true })
		.click();
	const composer = page.getByRole("textbox", {
		name: "codex composer",
		exact: true,
	});
	await composer.click();
	await page.evaluate(() =>
		navigator.clipboard.writeText("Pasted while the explanation was open"),
	);
	await composer.press("Control+V");
	assert.equal(
		await composer.inputValue(),
		"Pasted while the explanation was open",
	);
	await page
		.locator("#codex")
		.getByRole("button", { name: "Send draft", exact: true })
		.click();
	assert.equal(await count(), 1);
	checks.push("another pane remains editable, accepts paste and can submit");
	await reset();
	await page
		.locator("#codex")
		.getByRole("button", { name: "Continue session", exact: true })
		.click();
	await page.keyboard.press("Escape");
	await page.waitForFunction(
		() => document.querySelectorAll('[role="dialog"]').length === 0,
	);
	assert.equal(await count(), 0);
	checks.push("Escape dismisses without sending");
	await page.evaluate(() => {
		window.usageFixture.unknown = true;
		window.usageFixture.recoveries.codex.resetAt = null;
		window.usageFixture.emit();
	});
	await page
		.locator("#codex")
		.getByRole("button", { name: "Auto-continue at reset", exact: true })
		.click();
	await page
		.getByRole("button", { name: "Enable auto-continue", exact: true })
		.click();
	await page.getByRole("alert").waitFor();
	assert.equal(
		await page
			.getByRole("alert")
			.evaluate((el) => getComputedStyle(el).userSelect),
		"text",
	);
	assert.equal(
		await page.evaluate(
			() => window.usageFixture.recoveries.codex.autoContinue,
		),
		false,
	);
	checks.push(
		"unknown reset remains unscheduled with a selectable explanation",
	);
	await reset();
	for (const width of [1080, 680, 390, 300]) {
		await page.setViewportSize({ width, height: 900 });
		assert.ok(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= innerWidth,
			),
		);
		await page
			.locator("#codex")
			.getByRole("button", { name: "Auto-continue at reset", exact: true })
			.click();
		const box = await page.getByRole("dialog").boundingBox();
		assert.ok(box.x >= 0 && box.x + box.width <= width + 1);
		await page.keyboard.press("Escape");
	}
	checks.push(
		"no horizontal overflow or clipped popovers at 300, 390, 680 and 1080 pixels",
	);
	await page.setViewportSize({ width: 1080, height: 850 });
	await page.screenshot({
		path: resolve(output, "controls.png"),
		animations: "disabled",
	});
	await page
		.locator("#codex")
		.getByRole("button", { name: "Continue session", exact: true })
		.click();
	await page.screenshot({
		path: resolve(output, "explanation.png"),
		animations: "disabled",
	});
	assert.deepEqual(errors, []);
	await writeFile(
		resolve(output, "checks.json"),
		JSON.stringify({ checks, errors }, null, 2),
	);
	console.log(JSON.stringify({ output, checks, errors }, null, 2));
} finally {
	await context.close();
	await browser.close();
	await new Promise((done) => server.close(done));
}
