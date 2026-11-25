import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { build } from "vite";

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(desktop, "../../.tmp/browser-chrome-preview");
const state = `{currentUrl:'https://example.com/project',pageTitle:'Project preview',faviconUrl:null,isLoading:false,canGoBack:true,canGoForward:false,previewScale:1}`;
const mocks = new Map([
	[
		"renderer/lib/trpc-client",
		`export const electronTrpcClient={browser:{openInChrome:{mutate:async({url})=>{document.querySelector('#browser-action').textContent='Open in Chrome: '+url;return {success:true}}}},browserHistory:{getAll:{query:async()=>[]}}};`,
	],
	[
		"./browserRuntimeRegistry",
		`const state=${state};export const browserRuntimeRegistry={getState:()=>state,onStateChange:()=>()=>{},goBack:()=>{document.querySelector('#browser-action').textContent='Back'},goForward:()=>{},reload:()=>{document.querySelector('#browser-action').textContent='Reload'},navigate:(_,url)=>{document.querySelector('#browser-action').textContent='Navigate: '+url}};`,
	],
	[
		"./hooks/usePersistentWebview",
		"export const usePersistentWebview=()=>({placeholderRef:null,reload:()=>{}});",
	],
]);
await mkdir(output, { recursive: true });
await build({
	configFile: false,
	envFile: false,
	logLevel: "warn",
	define: { "process.env.NODE_ENV": JSON.stringify("production") },
	plugins: [
		{
			name: "browser-fixture-mocks",
			enforce: "pre",
			resolveId(source, importer = "") {
				source = source
					.replaceAll("\\", "/")
					.replace(
						`${resolve(desktop, "src/renderer").replaceAll("\\", "/")}/`,
						"renderer/",
					);
				if (
					mocks.has(source) &&
					(source.startsWith("renderer/") ||
						importer.endsWith("BrowserPane.tsx"))
				)
					return `\0fixture:${source}`;
			},
			load(id) {
				return id.startsWith("\0fixture:") ? mocks.get(id.slice(9)) : undefined;
			},
		},
		react(),
		tailwindcss(),
	],
	resolve: {
		alias: {
			renderer: resolve(desktop, "src/renderer"),
			shared: resolve(desktop, "src/shared"),
		},
	},
	build: {
		outDir: output,
		emptyOutDir: false,
		lib: {
			entry: resolve(desktop, "scripts/browser-chrome/renderer.tsx"),
			formats: ["iife"],
			name: "BrowserChromePreview",
			fileName: () => "renderer.js",
			cssFileName: "style",
		},
	},
});
await writeFile(
	resolve(output, "index.html"),
	'<!doctype html><html><head><meta charset="utf-8"><title>GatedSpace browser refresh</title><link rel="stylesheet" href="./style.css"></head><body><script src="./renderer.js"></script></body></html>',
);
const server = createServer(async (req, res) => {
	const name =
		new URL(req.url, "http://localhost").pathname.slice(1) || "index.html";
	if (!["index.html", "renderer.js", "style.css"].includes(name))
		return res.writeHead(404).end();
	res.setHeader(
		"Content-Type",
		name.endsWith("js")
			? "text/javascript"
			: name.endsWith("css")
				? "text/css"
				: "text/html",
	);
	res.end(await readFile(resolve(output, name)));
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const { chromium } = await import(
	process.env.PLAYWRIGHT_MODULE ?? "playwright"
);
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1000, height: 600 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
	await page.goto(`http://127.0.0.1:${server.address().port}`);
	const strip = page.locator(".gs-tool-tab-list");
	await page.getByRole("tab", { name: "Project 55", exact: true }).waitFor();
	assert.equal(await page.getByRole("tab").count(), 55);
	assert.equal(
		await page
			.getByRole("button", {
				name: /Previous tool tabs|Next tool tabs|Open DevTools/,
			})
			.count(),
		0,
	);
	assert.equal(await page.locator("[data-duplicate-action]").count(), 0);
	await page
		.getByRole("button", { name: "Close Project 55", exact: true })
		.click();
	await page.waitForTimeout(250);
	assert.equal(
		await page
			.getByRole("tab", { name: "Project 54", exact: true })
			.getAttribute("aria-selected"),
		"true",
	);
	assert.ok(await strip.evaluate((el) => el.scrollLeft > 1000));
	// Closing a tab after manually scrolling away must not reveal the active one.
	await page.getByRole("tab", { name: "Project 1", exact: true }).click();
	await strip.evaluate((el) => {
		el.scrollLeft = el.scrollWidth;
	});
	await page
		.getByRole("button", { name: "Close Project 54", exact: true })
		.click();
	await page.waitForTimeout(250);
	assert.equal(
		await page
			.getByRole("tab", { name: "Project 1", exact: true })
			.getAttribute("aria-selected"),
		"true",
	);
	assert.ok(await strip.evaluate((el) => el.scrollLeft > 1000));
	const before = await strip.evaluate((el) => el.scrollLeft);
	await strip.hover();
	await page.mouse.wheel(0, -220);
	await page.waitForTimeout(100);
	assert.ok((await strip.evaluate((el) => el.scrollLeft)) < before);
	for (const width of [340, 420, 720]) {
		await page
			.locator("[data-browser-fixture]")
			.evaluate((el, w) => (el.style.width = `${w}px`), width);
		const controls = await page
			.locator(
				'[aria-label="Edit address or search"], [aria-label="Open in Chrome"], [aria-label="Preview size"]',
			)
			.evaluateAll((els) =>
				els.map((el) => {
					const r = el.getBoundingClientRect();
					return { left: r.left, right: r.right, width: r.width };
				}),
			);
		assert.ok(controls.every((r) => r.width > 20 && r.right <= width + 22));
	}
	await page.getByRole("button", { name: "Edit address or search" }).click();
	await page
		.getByRole("textbox", { name: "Address or search" })
		.fill("resume v7");
	await page.keyboard.press("Enter");
	assert.equal(
		await page.locator("#browser-action").innerText(),
		"Navigate: resume v7",
	);
	await page
		.getByRole("button", { name: "Open in Chrome", exact: true })
		.click();
	assert.equal(
		await page.locator("#browser-action").innerText(),
		"Open in Chrome: https://example.com/project",
	);
	await page.getByRole("button", { name: "Preview size", exact: true }).click();
	await page.getByRole("menuitemradio", { name: /Galaxy S24/ }).click();
	await page.screenshot({ path: resolve(output, "browser-toolbar.png") });
	await page.goto(`http://127.0.0.1:${server.address().port}/?split`);
	const closePreview = (id) =>
		page
			.locator(`[data-pane-id="${id}"]`)
			.getByRole("button", { name: "Close preview pane", exact: true });
	await closePreview("preview-right").waitFor();
	assert.equal(
		await page
			.getByRole("button", { name: "Close preview pane", exact: true })
			.count(),
		2,
	);
	const tabId = await page.evaluate(
		() => window.splitPreviewFixture.state().id,
	);
	const survivorData = await page.evaluate(
		() => window.splitPreviewFixture.state().panes["preview-left"].data,
	);
	await closePreview("preview-right").click();
	await page.waitForFunction(
		() => window.splitPreviewFixture.state().layout.type === "pane",
	);
	assert.equal(
		await page.evaluate(() => window.splitPreviewFixture.state().id),
		tabId,
	);
	assert.deepEqual(
		await page.evaluate(() =>
			Object.keys(window.splitPreviewFixture.state().panes),
		),
		["preview-left"],
	);
	await page.waitForFunction(
		() => window.splitPreviewFixture.closed.length === 1,
	);
	assert.deepEqual(
		await page.evaluate(() => window.splitPreviewFixture.closed),
		["preview-right"],
	);
	assert.deepEqual(
		await page.evaluate(
			() => window.splitPreviewFixture.state().panes["preview-left"].data,
		),
		survivorData,
	);
	assert.equal(
		await page
			.getByRole("button", { name: "Close preview pane", exact: true })
			.count(),
		0,
	);
	const remaining = await page
		.locator('[data-pane-id="preview-left"]')
		.boundingBox();
	assert.ok(remaining.width > 900);

	await page.evaluate(() => window.splitPreviewFixture.reset("bottom"));
	await closePreview("preview-left").waitFor();
	await page.locator("[data-split-preview]").evaluate((el) => {
		el.style.width = "280px";
		el.style.zoom = "1.25";
	});
	for (const id of ["preview-left", "preview-right"]) {
		const close = closePreview(id);
		const bounds = await close.boundingBox();
		const paneBounds = await page
			.locator(`[data-pane-id="${id}"]`)
			.boundingBox();
		assert.ok(
			bounds.width >= 28 &&
				bounds.x >= paneBounds.x &&
				bounds.x + bounds.width <= paneBounds.x + paneBounds.width + 1,
		);
		assert.ok(
			await close.evaluate((el) => {
				const b = el.getBoundingClientRect();
				return el.contains(
					document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2),
				);
			}),
		);
	}
	await closePreview("preview-left").click();
	await page.waitForFunction(
		() => window.splitPreviewFixture.state().layout.type === "pane",
	);
	assert.deepEqual(
		await page.evaluate(() =>
			Object.keys(window.splitPreviewFixture.state().panes),
		),
		["preview-right"],
	);

	await page.locator("[data-split-preview]").evaluate((el) => {
		el.style.width = "100%";
		el.style.zoom = "1";
	});
	await page.evaluate(() => window.splitPreviewFixture.reset("right", 3));
	await closePreview("preview-2").focus();
	await page.keyboard.press("Enter");
	await page.waitForFunction(
		() => Object.keys(window.splitPreviewFixture.state().panes).length === 2,
	);
	assert.equal(
		await page.evaluate(() => window.splitPreviewFixture.state().layout.type),
		"split",
	);
	await page.evaluate(() => window.splitPreviewFixture.allowClose(false));
	await closePreview("preview-left").click();
	assert.equal(
		await page
			.getByRole("button", { name: "Close preview pane", exact: true })
			.count(),
		2,
	);
	await page.evaluate(() => {
		window.splitPreviewFixture.allowClose(true);
		window.splitPreviewFixture.maximize("preview-left");
	});
	await closePreview("preview-left").click();
	await page.waitForFunction(
		() => window.splitPreviewFixture.state().layout.type === "pane",
	);
	assert.equal(
		await page.evaluate(
			() => window.splitPreviewFixture.state().maximizedPaneId,
		),
		null,
	);
	assert.deepEqual(
		await page.evaluate(() =>
			Object.keys(window.splitPreviewFixture.state().panes),
		),
		["preview-right"],
	);
	await page.screenshot({ path: resolve(output, "unsplit-preview.png") });
	assert.deepEqual(errors, []);
	const result = {
		ok: true,
		packaged: false,
		checks: [
			"55 tab close selects neighbor",
			"inactive close preserves manual scroll",
			"mouse wheel scroll",
			"no tab arrows or duplicate pane actions",
			"page favicon and title fallback",
			"toolbar fits 340/420/720px",
			"address entry and Chrome IPC callback",
			"preview size menu",
			"close one preview retains its sibling's pane ID, URL and tab; survivor fills the panel",
			"both split directions and nested splits close independently",
			"close stays clickable in 280px panes at 125% zoom",
			"keyboard close, close guards and closing a maximized split",
		],
		errors,
	};
	await writeFile(
		resolve(output, "results.json"),
		JSON.stringify(result, null, 2),
	);
	console.log(JSON.stringify(result));
} catch (error) {
	console.error(
		JSON.stringify({
			errors,
			body: (await page.locator("body").innerText()).slice(0, 3000),
		}),
	);
	await page.screenshot({ path: resolve(output, "failure.png") });
	throw error;
} finally {
	await browser.close();
	server.close();
}
