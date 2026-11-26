import assert from "node:assert/strict";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import tailwind from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { build } from "vite";

const desktop = resolve(import.meta.dirname, "..");
const fixture = resolve(desktop, "scripts/desktop-polish-preview");
const output = resolve(desktop, "../../.tmp/desktop-polish-preview");
await mkdir(output, { recursive: true });
for (const [entry, name, plugins] of [
	[
		"renderer.tsx",
		"renderer",
		[
			react(),
			tailwind(),
			{
				name: "isolated-release-version",
				enforce: "pre",
				load(id) {
					if (/renderer[/\\]lib[/\\]electron-trpc\.ts$/.test(id))
						return `export { electronTrpc } from ${JSON.stringify(resolve(fixture, "fixture-client.ts").replaceAll("\\", "/"))};`;
				},
			},
		],
	],
	["overlay-fixture.ts", "overlay", []],
]) {
	await build({
		configFile: false,
		envFile: false,
		root: desktop,
		logLevel: "warn",
		plugins,
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
				entry: resolve(fixture, entry),
				formats: ["iife"],
				name: `Polish${name}`,
				fileName: () => `${name}.js`,
				cssFileName: name,
			},
		},
	});
}
await writeFile(
	resolve(output, "index.html"),
	'<!doctype html><html lang="en" class="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>GatedSpace · Desktop details</title><link rel="stylesheet" href="./renderer.css"></head><body><div id="root"></div><script src="./renderer.js"></script></body></html>',
);
const overlay = (
	await readFile(resolve(desktop, "src/renderer/computer-overlay.html"), "utf8")
)
	.replace(
		"</head>",
		'<link rel="stylesheet" href="./overlay.css"><link rel="stylesheet" href="./overlay-fixture.css"></head>',
	)
	.replace(
		'<script type="module" src="/computer-overlay.ts"></script>',
		'<section class="fixture"><small>COMPUTER CONTROL · DESIGN PREVIEW</small><h1>A visible hand at work.</h1><p>Move your pointer to see the marker, or play the cursor demo. These controls are simulated; they do not control your computer.</p><button id="fixture-move" type="button">Play cursor demo</button><a href="./index.html" target="_top">Release gallery</a><p id="fixture-feedback" role="status"></p></section><script src="./overlay.js"></script>',
	);
await writeFile(resolve(output, "overlay.html"), overlay);
await writeFile(
	resolve(output, "overlay-fixture.css"),
	await readFile(resolve(fixture, "overlay-fixture.css")),
);

const allowed = new Set([
	"index.html",
	"renderer.js",
	"renderer.css",
	"overlay.html",
	"overlay.js",
	"overlay.css",
	"overlay-fixture.css",
]);
const server = createServer(async (request, response) => {
	const file =
		new URL(request.url, "http://localhost").pathname.slice(1) || "index.html";
	if (!allowed.has(file)) return response.writeHead(404).end();
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
});
const page = await context.newPage();
const errors = [],
	checks = [];
page.on("pageerror", (e) => errors.push(e.message));
const base = `http://127.0.0.1:${server.address().port}`;
const gallery = page.getByRole("dialog");
const open = () =>
	page.getByRole("button", { name: "Preview What’s New", exact: true }).click();
try {
	await page.goto(base);
	await open();
	await gallery.waitFor();
	const first = await gallery.locator("h3").innerText();
	assert.equal(first, "A calmer mobile conversation");
	assert.equal(
		await gallery
			.getByRole("button", { name: "Previous highlight" })
			.isDisabled(),
		true,
	);
	await gallery.getByRole("button", { name: "Next highlight" }).click();
	assert.notEqual(await gallery.locator("h3").innerText(), first);
	await page.keyboard.press("ArrowLeft");
	assert.equal(await gallery.locator("h3").innerText(), first);
	const summary = await gallery.locator(".release-copy p").innerText();
	await gallery.getByRole("button", { name: "More detail" }).click();
	assert.ok(
		(await gallery.locator(".release-copy p").innerText()).length >
			summary.length,
	);
	await gallery.getByRole("button", { name: "Less detail" }).click();
	checks.push(
		"newest first; next, previous, keyboard and expandable detail work",
	);
	await page.screenshot({
		path: resolve(output, "release-gallery.png"),
		animations: "disabled",
	});
	for (const [width, height] of [
		[1080, 850],
		[390, 700],
		[300, 600],
		[800, 400],
	]) {
		await page.setViewportSize({ width, height });
		await page.evaluate(
			() =>
				new Promise((done) =>
					requestAnimationFrame(() => requestAnimationFrame(done)),
				),
		);
		const box = await gallery.boundingBox();
		assert.ok(
			box.width <= 441 && box.x >= 0 && box.x + box.width <= width + 1,
			JSON.stringify({ width, height, box }),
		);
		assert.ok(box.y >= 0 && box.y + box.height <= height + 1);
		assert.equal(
			await gallery.evaluate((el) => el.scrollWidth <= el.clientWidth),
			true,
		);
		const done = await gallery
			.getByRole("button", { name: "Done", exact: true })
			.boundingBox();
		assert.ok(done && done.y >= 0 && done.y + done.height <= height);
	}
	checks.push(
		"gallery stays within 300, 390 and 1080 pixel widths and a 400 pixel tall window",
	);
	await page.keyboard.press("Escape");
	await gallery.waitFor({ state: "hidden" });
	await page.setViewportSize({ width: 1080, height: 850 });
	await page.evaluate(() => window.releaseFixture.setVersion("1.18.66", false));
	await gallery.waitFor();
	await gallery.getByRole("button", { name: "Done", exact: true }).click();
	assert.equal(
		await page.evaluate(() =>
			localStorage.getItem("gatedspace:whats-new:seen-version"),
		),
		"1.18.66",
	);
	await page.evaluate(() => window.releaseFixture.setVersion("1.18.67", false));
	await gallery.waitFor();
	assert.equal(
		await gallery.getByText("GatedSpace 1.18.67", { exact: true }).count(),
		1,
	);
	await gallery.getByRole("button", { name: "Done", exact: true }).click();
	await page.reload();
	await page.evaluate(() => window.releaseFixture.setVersion("1.18.67", false));
	await page.waitForTimeout(80);
	assert.equal(await gallery.count(), 0);
	checks.push(
		"Done persists dismissal; a new version opens once; Escape dismisses",
	);
	await open();
	await page.emulateMedia({ reducedMotion: "reduce" });
	assert.equal(
		await gallery
			.locator(".release-slide")
			.evaluate((el) => getComputedStyle(el).animationName),
		"none",
	);
	await page.keyboard.press("Escape");
	checks.push("release slides respect reduced motion");

	await page.goto(`${base}/overlay.html`);
	await page.getByRole("button", { name: "Show control shortcuts" }).click();
	assert.equal(await page.locator("#control-detail").isVisible(), true);
	await page.getByRole("button", { name: "Return to session" }).click();
	assert.deepEqual(await page.evaluate(() => window.overlayFixture.calls), [
		"return",
	]);
	await page.getByRole("button", { name: "Hide control shortcuts" }).click();
	await page.mouse.move(500, 400);
	assert.equal(await page.locator("#control-pointer").isVisible(), true);
	await page.mouse.move(1075, 845);
	assert.equal(
		await page.locator("#control-pointer").getAttribute("data-left"),
		"true",
	);
	assert.equal(
		await page.locator("#control-pointer").getAttribute("data-up"),
		"true",
	);
	await page.mouse.move(700, 430);
	await page.screenshot({
		path: resolve(output, "computer-control.png"),
		animations: "disabled",
	});
	checks.push(
		"toolbar shortcuts and return action work; cursor label flips at screen edges",
	);
	const duration = await page.evaluate(() => {
		const start = performance.now();
		for (let i = 0; i < 1000; i++)
			window.overlayFixture.view.pointer({
				x: i % 800,
				y: 200,
				displayX: screenX,
				displayY: screenY,
			});
		return performance.now() - start;
	});
	await page.getByRole("button", { name: "Stop computer control" }).click();
	await page.mouse.move(600, 300);
	assert.equal(await page.locator("#control-pointer").isVisible(), false);
	assert.deepEqual(await page.evaluate(() => window.overlayFixture.calls), [
		"return",
		"stop",
	]);
	assert.equal(
		await page
			.getByRole("button", { name: "Stop computer control" })
			.isDisabled(),
		true,
	);
	checks.push(
		"Stop fires once and hides the cursor; moving afterward cannot reactivate it",
	);
	assert.equal(
		await page
			.locator("#control-border")
			.evaluate((el) => getComputedStyle(el, "::before").animationName),
		"none",
	);
	checks.push("overlay respects reduced motion");
	await page.evaluate(() => {
		const view = window.overlayFixture.view;
		view.render({ phase: "ready" });
		view.pointer({ x: 100, y: 180, displayX: screenX, displayY: screenY });
		view.render({ phase: "ready", activity: "Move" });
	});
	assert.equal(await page.locator("#control-pointer").isVisible(), true);
	await page.evaluate(() =>
		window.overlayFixture.view.pointer({
			x: 100,
			y: 180,
			displayX: screenX - 1920,
			displayY: screenY,
		}),
	);
	assert.equal(await page.locator("#control-pointer").isVisible(), false);
	checks.push(
		"cursor tolerates subscription ordering and appears only on its own monitor",
	);
	await page.setViewportSize({ width: 320, height: 600 });
	const toolbar = await page.locator("#control-toolbar").boundingBox();
	assert.ok(toolbar.x >= 0 && toolbar.x + toolbar.width <= 320);
	checks.push("compact toolbar fits a narrow preview");
	assert.deepEqual(errors, []);
	await writeFile(
		resolve(output, "checks.json"),
		JSON.stringify({ checks, errors, pointerUpdates1000Ms: duration }, null, 2),
	);
	console.log(
		JSON.stringify(
			{ output, checks, errors, pointerUpdates1000Ms: duration },
			null,
			2,
		),
	);
} finally {
	await context.close();
	await browser.close();
	await new Promise((done) => server.close(done));
}
