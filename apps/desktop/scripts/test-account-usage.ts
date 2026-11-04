/** Production account/session UI with simulated IPC. Does not switch live accounts. */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { build } from "vite";
import type { CodexSessionState } from "../src/shared/codex-session/types";

declare global {
	interface Window {
		accountFixture: {
			quota: () => void;
			failNextSwitch: () => void;
			usageUnavailable: (value: boolean) => void;
			read: () => { state: CodexSessionState; forceReads: number };
		};
	}
}
const { chromium } = await import(
	process.env.PLAYWRIGHT_MODULE ?? "playwright"
);
const output = resolve(
	import.meta.dirname,
	"../../../.tmp/account-usage-preview",
);
const fixture = resolve(
	import.meta.dirname,
	"account-usage-preview/fixture.ts",
).replaceAll("\\", "/");
await mkdir(output, { recursive: true });
if (!process.env.ACCOUNT_PREVIEW_SKIP_BUILD)
	await build({
		configFile: false,
		envFile: false,
		logLevel: "error",
		plugins: [
			react(),
			tailwindcss(),
			{
				name: "fixture-ipc",
				enforce: "pre",
				load(id) {
					if (/[/\\]renderer[/\\]lib[/\\]trpc-client\.ts$/.test(id))
						return `export { electronTrpcClient } from ${JSON.stringify(fixture)};`;
					if (/[/\\]renderer[/\\]lib[/\\]electron-trpc\.ts$/.test(id))
						return `export { electronTrpc } from ${JSON.stringify(fixture)};`;
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
				entry: resolve(
					import.meta.dirname,
					"account-usage-preview/renderer.tsx",
				),
				formats: ["iife"],
				name: "AccountPreview",
				fileName: () => "renderer.js",
				cssFileName: "style",
			},
		},
	});
await writeFile(
	resolve(output, "index.html"),
	'<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>GatedSpace account preview</title><link rel="stylesheet" href="./style.css"></head><body><script src="./renderer.js"></script></body></html>',
);
const server = createServer(async (request, response) => {
	const file =
		new URL(request.url ?? "/", "http://localhost").pathname.slice(1) ||
		"index.html";
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
});
await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
const port = (server.address() as { port: number }).port;
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors: string[] = [];
const checks: string[] = [];
page.on("pageerror", (error) => errors.push(error.message));
page.setDefaultTimeout(12_000);
try {
	await page.goto(`http://127.0.0.1:${port}`);
	const composer = page.getByRole("textbox", { name: "Message Codex" });
	await composer.waitFor();
	await page
		.getByRole("button", { name: "Codex account: Personal. Switch account" })
		.waitFor();
	await page
		.getByRole("button", { name: "Claude account: Writing. Switch account" })
		.waitFor();
	await page.getByTitle("Codex - Personal - 5h", { exact: true }).waitFor();
	checks.push("Both session account labels and account-specific footer");
	await page.getByRole("button", { name: "Usage", exact: true }).click();
	const usageDialog = page.getByRole("dialog", { name: "Usage", exact: true });
	for (const [label, percent] of [
		["Personal", 100],
		["School", 22],
		["Work", 61],
	] as const) {
		await usageDialog
			.getByRole("region", { name: `Codex usage for ${label}` })
			.getByText(`${percent}% used`, { exact: true })
			.waitFor();
	}
	await page.screenshot({
		animations: "disabled",
		path: resolve(output, "usage.png"),
	});
	await page.getByRole("button", { name: "Refresh usage" }).click();
	await page.waitForFunction(
		() => window.accountFixture.read().forceReads >= 3,
	);
	checks.push(
		"All Codex nicknames have independent usage and manual refresh bypasses cache",
	);
	await page.keyboard.press("Escape");
	await composer.fill("Keep this draft while switching accounts.");
	const before = await page.evaluate(() => window.accountFixture.read().state);
	await page.getByRole("button", { name: "Simulate usage limit" }).click();
	const recovery = page.getByRole("dialog", {
		name: "Continue with another account",
	});
	await recovery.waitFor();
	await recovery.getByRole("button", { name: /School/ }).waitFor();
	await page.screenshot({
		animations: "disabled",
		path: resolve(output, "recovery.png"),
	});
	await page.keyboard.press("Escape");
	await recovery.waitFor({ state: "detached" });
	await page
		.getByRole("button", { name: "Switch account", exact: true })
		.click();
	await recovery.getByRole("button", { name: /School/ }).click();
	await recovery.waitFor({ state: "detached" });
	await page
		.getByRole("button", { name: "Codex account: School. Switch account" })
		.waitFor();
	await page.getByTitle("Codex - School - 5h", { exact: true }).waitFor();
	assert.equal(
		await composer.inputValue(),
		"Keep this draft while switching accounts.",
	);
	const after = await page.evaluate(() => window.accountFixture.read().state);
	assert.equal(after.threadId, before.threadId);
	assert.deepEqual(after.items, before.items);
	assert.equal(after.usageLimit, undefined);
	checks.push(
		"Quota popup can be dismissed/reopened; switching retains thread, transcript and draft",
	);
	await page.evaluate(() => {
		window.accountFixture.failNextSwitch();
		window.accountFixture.quota();
	});
	await recovery.getByRole("button", { name: /Work/ }).click();
	await recovery
		.getByRole("alert")
		.getByText(/could not connect/)
		.waitFor();
	assert.equal(
		(await page.evaluate(() => window.accountFixture.read().state)).accountId,
		"school",
	);
	await page.keyboard.press("Escape");
	assert.equal(
		await composer.inputValue(),
		"Keep this draft while switching accounts.",
	);
	checks.push(
		"Failed switch retains the original account and displays a retryable error",
	);
	await page.evaluate(() => window.accountFixture.usageUnavailable(true));
	await page.getByRole("button", { name: "Usage", exact: true }).click();
	await page.getByRole("button", { name: "Refresh usage" }).click();
	const work = usageDialog.getByRole("region", {
		name: "Codex usage for Work",
	});
	await work.getByText(/Usage unavailable/).waitFor();
	await page.evaluate(() => window.accountFixture.usageUnavailable(false));
	await work.getByRole("button", { name: "Retry" }).click();
	await work.getByText("61% used", { exact: true }).waitFor();
	checks.push(
		"Unavailable account is isolated and retry restores its own reading",
	);
	await page.keyboard.press("Escape");
	await page.setViewportSize({ width: 440, height: 850 });
	await page
		.getByRole("button", { name: "Switch account", exact: true })
		.click();
	await recovery.waitFor();
	assert.equal(
		await page.evaluate(
			() => document.documentElement.scrollWidth > innerWidth,
		),
		false,
	);
	await page.screenshot({
		animations: "disabled",
		path: resolve(output, "narrow.png"),
	});
	checks.push("Narrow sidebar popup fits without horizontal overflow");
	await page.keyboard.press("Escape");
	await page.getByRole("button", { name: "Usage", exact: true }).click();
	await usageDialog.waitFor();
	await usageDialog.evaluate((element) =>
		Promise.all(element.getAnimations().map((animation) => animation.finished)),
	);
	assert.equal(
		await usageDialog.evaluate(
			(element) => element.scrollWidth > element.clientWidth + 1,
		),
		false,
	);
	checks.push(
		"Usage cards scroll vertically in narrow windows without clipping",
	);
	assert.deepEqual(errors, []);
	console.log(
		JSON.stringify(
			{
				passed: checks,
				errors,
				evidence:
					"Production renderer components; simulated account/provider IPC",
			},
			null,
			2,
		),
	);
} catch (error) {
	await page.screenshot({ path: resolve(output, "failure.png") });
	console.error(JSON.stringify({ errors, checks }));
	throw error;
} finally {
	await browser.close();
	server.close();
}
