import assert from "node:assert/strict";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { build } from "vite";
import { topBarPreviewMocks } from "./build-status/topbar-mocks.mjs";

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(desktop, "../../.tmp/build-status-preview");
await mkdir(output, { recursive: true });
await build({
	configFile: false,
	envFile: false,
	logLevel: "warn",
	define: { "process.env.NODE_ENV": JSON.stringify("production") },
	plugins: [topBarPreviewMocks(desktop), react(), tailwindcss()],
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
			entry: resolve(desktop, "scripts/build-status/renderer.tsx"),
			formats: ["iife"],
			name: "BuildStatusPreview",
			fileName: () => "renderer.js",
			cssFileName: "style",
		},
	},
});
await writeFile(
	resolve(output, "index.html"),
	'<!doctype html><html><head><meta charset="utf-8"><style>@layer theme, base, components, utilities;</style><title>GatedSpace build status preview</title><link rel="stylesheet" href="./style.css"></head><body><script src="./renderer.js"></script></body></html>',
);
const server = createServer(async (request, response) => {
	const file =
		new URL(request.url, "http://localhost").pathname.slice(1) || "index.html";
	if (!["index.html", "renderer.js", "style.css"].includes(file))
		return void response.writeHead(404).end();
	response.setHeader(
		"Content-Type",
		file.endsWith(".js")
			? "text/javascript"
			: file.endsWith(".css")
				? "text/css"
				: "text/html",
	);
	if (file === "style.css" && process.env.BUILD_STATUS_PACKAGED) {
		const assets = resolve(desktop, "dist/renderer/assets");
		response.end(
			(
				await Promise.all(
					(
						await readdir(assets)
					)
						.filter(
							(name) =>
								name.endsWith(".css") && !name.startsWith("computer-overlay-"),
						)
						.map((name) => readFile(resolve(assets, name), "utf8")),
				)
			).join("\n"),
		);
	} else response.end(await readFile(resolve(output, file)));
});
await new Promise((done) =>
	server.listen(
		process.env.BUILD_STATUS_PREVIEW_PORT
			? Number(process.env.BUILD_STATUS_PREVIEW_PORT)
			: 0,
		"127.0.0.1",
		done,
	),
);
const url = `http://127.0.0.1:${server.address().port}`;
console.log(url);
if (!process.argv.includes("--serve")) {
	const { chromium } = await import(
		process.env.PLAYWRIGHT_MODULE ?? "playwright"
	);
	const browser = await chromium.launch({ channel: "chrome", headless: true });
	const page = await browser.newPage({
		viewport: { width: 1500, height: 800 },
	});
	const errors = [];
	page.on("pageerror", (error) => {
		errors.push(error.message);
		console.error(error.message);
	});
	try {
		await page.goto(url);
		await page.locator(".build-status-chip").waitFor();
		await page.evaluate(() => {
			// Even high-z pane overlays must stay inside the content layer.
			const overlay = document.createElement("div");
			overlay.dataset.headerOccluder = "true";
			overlay.style.cssText =
				"position:absolute;inset:0;z-index:1000;background:var(--background)";
			document.querySelector(".gs-tool-workspace").append(overlay);
		});
		const verticalChecks = [];
		for (const zoom of [1, 1.25, 1.5]) {
			for (const inset of [9, 0]) {
				await page.evaluate(
					({ zoom, inset }) => {
						document.body.style.zoom = String(zoom);
						// Electron zoom reduces the CSS viewport; body zoom alone would
						// expand the global 100vw body beyond the browser window.
						document.body.style.width = `${100 / zoom}vw`;
						document.documentElement.style.setProperty(
							"--gs-pane-inset",
							`${inset}px`,
						);
					},
					{ zoom, inset },
				);
				const geometry = await page.evaluate(() => {
					const rect = (selector) => {
						const r = document.querySelector(selector).getBoundingClientRect();
						return {
							top: r.top,
							bottom: r.bottom,
							height: r.height,
							center: (r.top + r.bottom) / 2,
						};
					};
					return {
						bar: rect(".workspace-topbar"),
						pane: rect("[data-preview-pane]"),
						launcher: rect("#workspace-topbar-presets-slot > div"),
						tabs: rect("#workspace-topbar-tabs-slot > div"),
						build: rect(".build-status-chip"),
						search: rect('[aria-label="Search files"]'),
						close: rect('[aria-label="Close window"]'),
					};
				});
				if (zoom === 1 && inset === 9)
					await page.screenshot({
						path: resolve(output, "topbar-vertical.png"),
					});
				// Bounding rectangles remain correct when another pane paints over
				// the toolbar. Sample its visible lower surface, including controls.
				const occluded = await page.evaluate(() => {
					const selectors = [
						"#workspace-topbar-presets-slot > div",
						"#workspace-topbar-tabs-slot > div",
						'[aria-label="Codex"]',
						'[aria-label="New group"]',
						'[aria-label="Search files"]',
						'[aria-label="Close window"]',
						".build-status-chip",
					];
					return selectors.filter((selector) => {
						const el = document.querySelector(selector);
						const r = el.getBoundingClientRect();
						const hit = document.elementFromPoint(
							(r.left + r.right) / 2,
							r.bottom - 3,
						);
						return !hit || !el.contains(hit);
					});
				});
				assert.deepEqual(
					occluded,
					[],
					`Header covered by workspace at ${zoom}x/inset${inset}`,
				);
				const middle = (geometry.bar.top + geometry.pane.top) / 2;
				for (const key of ["launcher", "tabs", "build", "search", "close"]) {
					assert.ok(
						Math.abs(geometry[key].center - middle) < 1,
						`${key} must center in header band at ${zoom}x/inset${inset}: ${geometry[key].center} vs ${middle}`,
					);
				}
				for (const key of ["launcher", "tabs"]) {
					assert.ok(
						Math.abs(geometry[key].height - 46 * zoom) < 1,
						`${key} height changed`,
					);
					assert.ok(
						geometry[key].top >= geometry.bar.top &&
							geometry[key].bottom <= geometry.pane.top,
						`${key} must clear pane edge`,
					);
				}
				verticalChecks.push({ zoom, inset, ...geometry });
			}
		}
		await page.evaluate(() => {
			document.querySelector("[data-header-occluder]").remove();
			document.body.style.zoom = "1";
			document.body.style.width = "100vw";
			document.documentElement.style.setProperty("--gs-pane-inset", "9px");
		});
		await page.evaluate(() => {
			const job = {
				id: "public-30",
				version: "1.18.30",
				channel: "public",
				architectures: ["arm64", "x64"],
				sourceCommit: "33cc8dec0",
				stage: "ready",
				verified: true,
				published: true,
				message: "Preview",
				updatedAt: new Date().toISOString(),
			};
			window.dispatchEvent(
				new CustomEvent("preview-builds", {
					detail: [
						job,
						{
							...job,
							id: "personal-31",
							channel: "personal",
							version: "1.18.31",
						},
					],
				}),
			);
		});
		const layoutChecks = [];
		for (const width of [2048, 1600, 1440, 1280, 1024, 900, 800]) {
			await page.setViewportSize({ width, height: 800 });
			await page.locator(".build-status-chip").waitFor();
			const layout = await page.evaluate(() => {
				const box = (selector) => {
					const r = document.querySelector(selector).getBoundingClientRect();
					return {
						left: r.left,
						right: r.right,
						center: (r.left + r.right) / 2,
						width: r.width,
					};
				};
				return {
					brand: box(".topbar-brand"),
					chip: box(".build-status-chip"),
					presets: box("#workspace-topbar-presets-slot"),
					actions: box(".topbar-actions"),
					tabs: box("#workspace-topbar-tabs-slot"),
					close: box('[aria-label="Close window"]'),
					shells: document.querySelector("#workspace-topbar-shells-slot"),
				};
			});
			assert.ok(
				layout.chip.left >= layout.brand.right,
				`brand overlap at ${width}`,
			);
			assert.ok(
				layout.chip.right <= layout.presets.left,
				`launcher overlap at ${width}`,
			);
			assert.ok(
				Math.abs(
					layout.chip.center -
						(layout.brand.right + layout.presets.left - 12) / 2,
				) < 1,
				`left gap centering at ${width}`,
			);
			assert.ok(
				layout.presets.right <= layout.actions.left,
				`actions overlap at ${width}`,
			);
			assert.ok(
				layout.close.right <= width,
				`window controls cropped at ${width}`,
			);
			assert.equal(layout.shells, null);
			await page.locator(".build-status-chip").click();
			await page.locator(".build-status-popover").waitFor();
			await page.keyboard.press("Escape");
			await page.locator(".build-status-popover").waitFor({ state: "hidden" });
			if (width <= 1300) {
				const fits = await page
					.locator("#workspace-topbar-presets-slot > div")
					.evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
				assert.ok(fits, `all four agent icons fit at ${width}`);
			}
			layoutChecks.push({ width, ...layout });
		}
		await page.setViewportSize({ width: 2048, height: 800 });
		await page.screenshot({ path: resolve(output, "topbar-wide.png") });
		await page.setViewportSize({ width: 1280, height: 800 });
		await page.screenshot({ path: resolve(output, "topbar-narrow.png") });
		await page.setViewportSize({ width: 1500, height: 800 });
		await page.getByRole("button", { name: "ready", exact: true }).click();
		await page
			.getByRole("button", { name: "Installer builds: Ready, 1.18.30" })
			.click();
		await page.getByRole("button", { name: "Downloads" }).click();
		await page.getByLabel("Opened URL").waitFor();
		await page.screenshot({ path: resolve(output, "ready.png") });
		await page.keyboard.press("Escape");
		await page.getByRole("button", { name: "building", exact: true }).click();
		await page
			.getByRole("button", { name: "Installer builds: Building, 1.18.30" })
			.click();
		assert.equal(
			await page
				.getByRole("button", { name: "Dismiss public 1.18.30" })
				.count(),
			0,
		);
		await page.keyboard.press("Escape");
		await page.getByRole("button", { name: "failed", exact: true }).click();
		await page
			.getByRole("button", {
				name: "Installer builds: Needs attention, 1.18.30",
			})
			.click();
		assert.equal(
			await page
				.locator(".build-status-job p")
				.evaluate((el) => getComputedStyle(el).userSelect),
			"text",
		);
		await page.getByRole("button", { name: "Dismiss public 1.18.30" }).click();
		assert.equal(await page.locator(".build-status-chip").count(), 0);
		await page.getByRole("button", { name: "verifying", exact: true }).click();
		await page.emulateMedia({ reducedMotion: "reduce" });
		assert.equal(
			await page
				.locator(".build-status-working")
				.evaluate((el) => getComputedStyle(el).animationName),
			"none",
		);
		await page.setViewportSize({ width: 480, height: 720 });
		await page
			.getByRole("button", { name: "Installer builds: Verifying, 1.18.30" })
			.click();
		const bounds = await page.locator(".build-status-popover").boundingBox();
		assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 480);
		await page.screenshot({ path: resolve(output, "narrow.png") });
		await page.keyboard.press("Escape");
		await page
			.getByRole("button", { name: "Installer builds: Verifying, 1.18.30" })
			.focus();
		await page.keyboard.press("Enter");
		await page.locator(".build-status-popover").waitFor();
		assert.deepEqual(errors, []);
		const result = {
			ok: true,
			packaged: !!process.env.BUILD_STATUS_PACKAGED,
			layoutChecks,
			verticalChecks,
			checks: [
				"header lower edges remain visible and hit-testable above positioned panes and high-z overlays",
				"vertical center, unchanged heights and pane clearance at three zoom levels and two shell insets",
				"real TopBar gap centering and non-overlap at seven widths",
				"download action",
				"active build cannot be dismissed",
				"selectable failure",
				"dismissal",
				"reduced motion",
				"narrow layout",
				"keyboard reopen",
			],
			errors,
		};
		await writeFile(
			resolve(output, "results.json"),
			JSON.stringify(result, null, 2),
		);
		console.log(JSON.stringify(result));
	} finally {
		await browser.close();
		server.close();
	}
}
