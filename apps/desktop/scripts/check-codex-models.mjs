/** Production model controls with simulated IPC; no live user conversations. */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { build } from "vite";

const { chromium } = await import(
	process.env.PLAYWRIGHT_MODULE ?? "playwright"
);
const output = resolve(import.meta.dirname, "../../../.tmp/codex-62-verify/ui");
await mkdir(output, { recursive: true });
await build({
	configFile: false,
	envFile: false,
	logLevel: "warn",
	plugins: [
		react(),
		tailwindcss(),
		{
			name: "model-fixture",
			enforce: "pre",
			load(id) {
				if (/[/\\]renderer[/\\]lib[/\\]trpc-client\.ts$/.test(id))
					return `export { electronTrpcClient } from ${JSON.stringify(resolve(import.meta.dirname, "codex-models/fixture-client.ts").replaceAll("\\", "/"))};`;
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
			entry: resolve(import.meta.dirname, "codex-models/renderer.tsx"),
			formats: ["iife"],
			name: "CodexModels",
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
		const name =
			new URL(request.url ?? "/", "http://localhost").pathname.slice(1) ||
			"index.html";
		if (!["index.html", "renderer.js", "style.css"].includes(name))
			return response.writeHead(404).end();
		response.setHeader(
			"Content-Type",
			name.endsWith(".js")
				? "text/javascript"
				: name.endsWith(".css")
					? "text/css"
					: "text/html",
		);
		response.end(await readFile(resolve(output, name)));
	} catch {
		response.writeHead(500).end();
	}
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const browser = await chromium.launch({ channel: "chrome", headless: true });
const checks = [];
const errors = [];
try {
	const page = await browser.newPage({ viewport: { width: 900, height: 800 } });
	page.on("pageerror", (error) => errors.push(error.message));
	const origin = `http://127.0.0.1:${server.address().port}`;
	const open = () =>
		page.getByRole("button", { name: "Model and effort", exact: true }).click();
	const picker = page.getByRole("combobox", {
		name: "Codex model",
		exact: true,
	});
	const slider = page.getByRole("slider", { name: "Reasoning effort" });
	await page.goto(`${origin}/?missing`);
	await open();
	await page.getByText("This model is not listed", { exact: false }).waitFor();
	assert.equal(await picker.isEnabled(), true);
	assert.equal(await slider.count(), 0);
	assert.equal(
		await page.getByRole("button", { name: "Set up Codex" }).count(),
		0,
	);
	checks.push(
		"Unavailable model explains recovery without a fake lowest-effort slider or account setup",
	);
	await page.screenshot({ path: resolve(output, "unavailable-model.png") });
	await picker.selectOption("gpt-6-astra");
	assert.equal(await slider.inputValue(), "3");
	assert.equal(await slider.getAttribute("aria-valuetext"), "Extra High");
	await slider.fill("2");
	await page.keyboard.press("Escape");
	await page
		.getByRole("textbox", { name: "Message Codex" })
		.fill("Draft survives model recovery");
	checks.push(
		"Can choose a supported model and change effort without closing the session",
	);
	await page.evaluate(() => window.codexModelsFixture.update());
	const before = await page.evaluate(() => window.codexModelsFixture.queries());
	await open();
	await page.waitForFunction(
		() => !!document.querySelector('option[value="gpt-6.2-astra"]'),
	);
	assert.ok(
		(await page.evaluate(() => window.codexModelsFixture.queries())) > before,
	);
	await picker.selectOption("gpt-6.2-astra");
	assert.equal(await slider.inputValue(), "2");
	assert.equal(await slider.getAttribute("aria-valuetext"), "High");
	assert.equal(await slider.getAttribute("max"), "5");
	await picker.selectOption("gpt-6.2-sol");
	assert.equal(await slider.getAttribute("aria-valuetext"), "High");
	checks.push(
		"Opening the picker discovers new Astra/Sol models and preserves High across models",
	);
	await page.getByRole("button", { name: "Fast mode", exact: true }).click();
	await page.keyboard.press("Escape");
	await page.evaluate(() => history.replaceState(null, "", "/"));
	await page.reload();
	await open();
	await picker.waitFor();
	assert.equal(await picker.inputValue(), "gpt-6.2-sol");
	assert.equal(await slider.getAttribute("aria-valuetext"), "High");
	assert.equal(
		await page
			.getByRole("button", { name: "Fast mode", exact: true })
			.getAttribute("aria-pressed"),
		"true",
	);
	const starts = await page.evaluate(() => window.codexModelsFixture.starts);
	assert.equal(starts[0].model, "gpt-6.2-sol");
	assert.equal(starts[0].effort, "high");
	assert.equal(starts[0].resumeSessionId, "thread-fixture");
	assert.equal(
		await page.getByRole("textbox", { name: "Message Codex" }).inputValue(),
		"Draft survives model recovery",
	);
	checks.push(
		"Reload restores model, effort, Fast and draft, passing preferences into the same thread resume",
	);
	await slider.fill("3");
	await page.screenshot({ path: resolve(output, "gpt-62-extra-high.png") });
	await page.keyboard.press("Escape");
	await page.evaluate(() => window.codexModelsFixture.fail());
	await open();
	assert.equal(await picker.isEnabled(), true);
	assert.equal(await slider.getAttribute("aria-valuetext"), "Extra High");
	checks.push(
		"A temporary refresh failure retains cached choices and the user's effort",
	);
	assert.deepEqual(errors, []);
	await writeFile(
		resolve(output, "checks.json"),
		JSON.stringify({ checks, errors }, null, 2),
	);
	console.log(JSON.stringify({ checks, errors }, null, 2));
} finally {
	await browser.close();
	await new Promise((done) => server.close(done));
}
