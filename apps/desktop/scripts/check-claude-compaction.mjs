import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import tailwind from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { build } from "vite";

const desktop = resolve(import.meta.dirname, "..");
const output = resolve(desktop, "../../.tmp/claude-compaction-preview");
await mkdir(output, { recursive: true });
await build({
	configFile: false,
	envFile: false,
	logLevel: "warn",
	plugins: [react(), tailwind()],
	define: { "process.env": "{}" },
	resolve: {
		alias: {
			shared: resolve(desktop, "src/shared"),
			renderer: resolve(desktop, "src/renderer"),
		},
	},
	build: {
		outDir: output,
		emptyOutDir: false,
		lib: {
			entry: resolve(desktop, "scripts/claude-compaction-preview/renderer.tsx"),
			formats: ["iife"],
			name: "CompactionPreview",
			fileName: () => "renderer.js",
			cssFileName: "style",
		},
	},
});
await writeFile(
	resolve(output, "index.html"),
	'<!doctype html><html lang="en" class="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Claude compaction settings</title><link rel="stylesheet" href="./style.css"></head><body><script src="./renderer.js"></script></body></html>',
);
const server = createServer(async (request, response) => {
	const name =
		new URL(request.url, "http://localhost").pathname.slice(1) || "index.html";
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
});
await new Promise((accept) => server.listen(0, "127.0.0.1", accept));
const { chromium } = await import(
	process.env.PLAYWRIGHT_MODULE ?? "playwright"
);
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1000, height: 850 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const checks = [];
const url = `http://127.0.0.1:${server.address().port}`;
const choose = async (name) => {
	await page.getByRole("combobox", { name: "Compaction mode" }).click();
	await page.getByRole("option", { name, exact: true }).click();
};
try {
	await page.goto(url);
	assert.match(await page.getByRole("combobox").innerText(), /Off/);
	await page.getByRole("button", { name: "Save for all accounts" }).click();
	await page.getByRole("status").waitFor();
	assert(
		await page
			.getByRole("button", { name: "Save for all accounts" })
			.isDisabled(),
	);
	checks.push("existing Off preference can be saved for future accounts");
	await choose("Custom context window");
	const input = page.getByRole("spinbutton", {
		name: "Context window (thousand tokens)",
	});
	assert.equal(await input.inputValue(), "500");
	await input.fill("99");
	assert(
		await page
			.getByRole("button", { name: "Save for all accounts" })
			.isDisabled(),
	);
	await page.getByRole("alert").waitFor();
	await input.fill("750");
	await page.getByRole("button", { name: "Save for all accounts" }).click();
	await page.getByRole("status").waitFor();
	assert.equal(await input.inputValue(), "750");
	checks.push("custom window, bounds validation and save/refetch");
	await choose("Off · compact manually");
	await page.getByRole("button", { name: "Save for all accounts" }).click();
	await page.getByRole("status").waitFor();
	assert.equal(await input.count(), 0);
	checks.push("Off removes threshold input and persists");
	await choose("Claude default");
	await page.getByRole("button", { name: "Save for all accounts" }).click();
	await page.getByRole("status").waitFor();
	checks.push("Claude default resets custom choice");
	await choose("Custom context window");
	for (const width of [1000, 600, 360]) {
		await page.setViewportSize({ width, height: 850 });
		assert(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= innerWidth,
			),
		);
		await page.screenshot({
			path: resolve(output, `settings-${width}.png`),
			fullPage: true,
		});
	}
	checks.push("no horizontal overflow at 360, 600 and 1000px");
	await page.getByRole("combobox").focus();
	await page.keyboard.press("ArrowDown");
	await page.getByRole("listbox").waitFor();
	await page.keyboard.press("Escape");
	assert(
		await page
			.getByRole("combobox")
			.evaluate((element) => element === document.activeElement),
	);
	checks.push("keyboard menu and focus return");
	await page.goto(`${url}?error`);
	await choose("Custom context window");
	await page.getByRole("button", { name: "Save for all accounts" }).click();
	const alert = page.getByRole("alert");
	await alert.waitFor();
	assert.match(await alert.innerText(), /Previous settings were restored/);
	assert.equal(
		await alert.evaluate((element) => getComputedStyle(element).userSelect),
		"text",
	);
	checks.push("save error is visible and selectable");
	assert.deepEqual(errors, []);
	await writeFile(
		resolve(output, "results.json"),
		JSON.stringify({ checks, errors, simulated: true }, null, 2),
	);
	console.log(JSON.stringify({ checks, errors }));
} finally {
	await browser.close();
	server.close();
}
