import assert from "node:assert/strict";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { build } from "vite";
import { controlsPreviewIpcMock } from "./controls-preview/mock-plugin.mjs";

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(desktop, "../../.tmp/session-controls-preview");
const packaged = process.env.CONTROLS_PACKAGED === "1";
await mkdir(output, { recursive: true });
await rm(resolve(output, "results.json"), { force: true });
await build({
	configFile: false,
	envFile: false,
	logLevel: "warn",
	define: { "process.env.NODE_ENV": JSON.stringify("production") },
	plugins: [controlsPreviewIpcMock(desktop), react(), tailwindcss()],
	resolve: {
		alias: [
			...[
				"renderer/lib/trpc-client",
				"renderer/routes/_authenticated/_dashboard/v2-workspace/providers/WorkspaceProvider",
				"renderer/hooks/host-service/useV2NotificationStatus",
				"renderer/stores/v2-notifications",
				"renderer/components/StatusIndicator",
			].map((find) => ({
				find,
				replacement: resolve(desktop, "scripts/controls-preview/mock.ts"),
			})),
			{ find: "renderer", replacement: resolve(desktop, "src/renderer") },
			{ find: "shared", replacement: resolve(desktop, "src/shared") },
		],
	},
	build: {
		outDir: output,
		emptyOutDir: false,
		lib: {
			entry: resolve(desktop, "scripts/controls-preview/renderer.tsx"),
			formats: ["iife"],
			name: "SessionControlsPreview",
			fileName: () => "renderer.js",
			cssFileName: "style",
		},
	},
});
await writeFile(
	resolve(output, "index.html"),
	'<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>@layer theme, base, components, utilities;</style><title>GatedSpace â€” Tabs and replies</title><link rel="stylesheet" href="/style.css"></head><body><script src="/renderer.js"></script></body></html>',
);
const server = createServer(async (req, res) => {
	const name =
		new URL(req.url, "http://localhost").pathname.slice(1) || "index.html";
	if (!["index.html", "renderer.js", "style.css"].includes(name))
		return void res.writeHead(404).end();
	res.setHeader(
		"Content-Type",
		name.endsWith(".js")
			? "text/javascript"
			: name.endsWith(".css")
				? "text/css"
				: "text/html",
	);
	if (name === "style.css" && packaged) {
		const assets =
			process.env.CONTROLS_STYLE_DIR ??
			resolve(desktop, "dist/renderer/assets");
		const styles = (await readdir(assets)).filter(
			(file) => file.endsWith(".css") && !file.startsWith("computer-overlay-"),
		);
		assert.ok(styles.length, "Compiled renderer styles are required");
		res.end(
			`${(await Promise.all(styles.map((file) => readFile(resolve(assets, file), "utf8")))).join("\n")}\n${await readFile(resolve(desktop, "scripts/controls-preview/style.css"), "utf8")}`,
		);
	} else res.end(await readFile(resolve(output, name)));
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const url = `http://127.0.0.1:${server.address().port}`;
await writeFile(
	resolve(
		output,
		process.argv.includes("--serve") ? "url.txt" : "check-url.txt",
	),
	url,
);
console.log(url);
if (!process.argv.includes("--serve")) {
	const { chromium } = await import(
		process.env.PLAYWRIGHT_MODULE ?? "playwright"
	);
	const browser = await chromium.launch({ channel: "chrome", headless: true });
	const page = await browser.newPage({
		viewport: { width: 1000, height: 1000 },
	});
	const errors = [],
		checks = [];
	page.on("pageerror", (error) => errors.push(error.message));
	const range = async (value) => {
		await page.getByLabel("Available width").fill(String(value));
	};
	const contained = async (root, button) => {
		const a = await page.locator(root).boundingBox(),
			b = await page
				.locator(root)
				.getByRole("button", { name: button, exact: true })
				.boundingBox();
		assert.ok(
			a && b && b.x >= a.x - 1 && b.x + b.width <= a.x + a.width + 1,
			`${button} must remain inside ${root}`,
		);
	};
	try {
		await page.goto(url);
		for (const variant of ["A Flow", "B Four", "C Focus"]) {
			await page.getByRole("button", { name: new RegExp(variant) }).click();
			for (const count of [4, 8, 16]) {
				await page.getByLabel("Tab count").selectOption(String(count));
				for (const width of [240, 380, 560, 720]) {
					await range(width);
					await contained(".concept-rail", "New tab");
				}
			}
			await page.getByRole("button", { name: "New tab", exact: true }).click();
			await page
				.getByRole("heading", { name: "New conversation 17", exact: true })
				.waitFor();
			await contained(".concept-rail", "New tab");
			await page
				.getByRole("button", { name: "Find a tab", exact: true })
				.click();
			await page.getByLabel("Search tabs").fill("Battery audit 16");
			await page
				.getByRole("button", { name: "Switch to Battery audit 16" })
				.click();
			await page
				.getByRole("heading", { name: "Battery audit 16", exact: true })
				.waitFor();
			await page
				.locator(".concept-rail")
				.getByRole("button", { name: "Close Battery audit 16" })
				.click();
			await page
				.getByRole("heading", { name: "New conversation 17", exact: true })
				.waitFor();
			await page
				.getByRole("button", { name: "Find a tab", exact: true })
				.click();
			await page.getByLabel("Search tabs").press("Escape");
			assert.equal(await page.locator(".tab-menu").count(), 0);
		}
		checks.push(
			"All three tab concepts: 4/8/16 tabs at 240/380/560/720px; add, close, search, switch, Escape; + remains inside the rail",
		);
		await page.getByRole("button", { name: /A Flow/ }).click();
		await page.getByLabel("Tab count").selectOption("16");
		await range(560);
		await page.waitForFunction(
			() =>
				document
					.querySelector(".tabs-window")
					?.getAttribute("data-fade-right") === "true",
		);
		await page.getByRole("button", { name: "New tab", exact: true }).click();
		await page.waitForFunction(
			() =>
				document
					.querySelector(".tabs-window")
					?.getAttribute("data-fade-left") === "true",
		);
		checks.push(
			"Flow edge fades switch as the active tab moves from first to last",
		);
		for (const provider of ["codex", "claude"]) {
			await page.getByLabel("Composer provider").selectOption(provider);
			const dimensions = await page
				.locator(".session-changes-pill")
				.evaluate((e) => ({
					height: e.getBoundingClientRect().height,
					font: parseFloat(getComputedStyle(e).fontSize),
				}));
			assert.ok(dimensions.height >= 40 && dimensions.font >= 14);
		}
		await page.getByRole("button", { name: /1 Widescreen/ }).click();
		await page
			.getByText("Sample reply received: Widescreen 16:9 (Recommended)", {
				exact: true,
			})
			.waitFor();
		await page.getByRole("button", { name: "Reset question" }).click();
		await page.getByRole("button", { name: /Other.*Write/ }).click();
		await page.getByLabel(/^Your answer:/).fill("Use a square layout");
		await page.getByLabel(/^Your answer:/).press("Control+Enter");
		await page
			.getByText("Sample reply received: Use a square layout", { exact: true })
			.waitFor();
		await page.getByLabel("Question scenario").selectOption("multiple");
		await page.getByRole("button", { name: /1 Widescreen/ }).click();
		assert.equal(await page.getByText(/^Sample reply received:/).count(), 0);
		await page
			.getByRole("button", { name: "2 30 seconds", exact: true })
			.click();
		await page
			.getByText(
				"Sample reply received: Widescreen 16:9 (Recommended) / 30 seconds",
				{ exact: true },
			)
			.waitFor();
		await page.getByLabel("Question scenario").selectOption("retry");
		await page.getByRole("button", { name: /2 Vertical/ }).click();
		await page.getByRole("button", { name: "Retry sending" }).click();
		await page
			.getByText("Sample reply received: Vertical 9:16", { exact: true })
			.waitFor();
		checks.push(
			"Actual question card: immediate choice delivery, Other + Ctrl+Enter, batched questions, failed-delivery retry; both actual pills meet size target",
		);
		await page.locator(".production-rail").waitFor({ state: "visible" });
		for (const width of [240, 380, 720]) {
			await range(width);
			await contained(".production-rail", "New group");
		}
		await page
			.locator(".production-rail")
			.getByRole("button", { name: "New group", exact: true })
			.click();
		await page.waitForFunction(
			() =>
				document.querySelectorAll(".production-rail [data-rail-tab]").length ===
				17,
		);
		await contained(".production-rail", "New group");
		const production = page.locator(".production-rail");
		const switchTo = async (name) => {
			const target = production.getByRole("button", { name, exact: true });
			await target.focus();
			await target.press("Enter");
			await page.waitForFunction((name) => {
				const tab = document.querySelector(
					'.production-rail [data-active="true"]',
				);
				return (
					tab?.textContent === name &&
					tab.dataset.expanded === "true" &&
					tab.querySelector(".gs-tabrail-label").clientWidth >=
						tab.querySelector(".gs-tabrail-label").scrollWidth
				);
			}, name);
		};
		await range(380);
		await switchTo("GS Edits 1");
		await page.waitForFunction(() => {
			const active = document.querySelector(
				'.production-rail [data-active="true"]',
			);
			return (
				active?.textContent === "GS Edits 1" &&
				active.getBoundingClientRect().width > 100 &&
				active.getBoundingClientRect().width < 185 &&
				active.querySelector(".gs-tabrail-label").clientWidth >=
					active.querySelector(".gs-tabrail-label").scrollWidth
			);
		});
		const tabTargets = () =>
			production.locator("[data-rail-tab]").evaluateAll((tabs) =>
				tabs.map((tab) => {
					const { x, y, width, height } = tab.getBoundingClientRect();
					return { x, y, width, height };
				}),
			);
		const beforeHover = await tabTargets();
		await production
			.getByRole("button", { name: "Filtrsoft 2", exact: true })
			.hover();
		const hoverName = page
			.locator(".gs-tabrail-namecard")
			.filter({ hasText: "Filtrsoft 2" })
			.first();
		await hoverName.waitFor({ state: "visible" });
		assert.ok(
			(await hoverName.boundingBox()).height < 230,
			"One compact thumbnail, no footer",
		);
		assert.equal(
			await hoverName.locator(".gs-tabrail-namecard-meta").count(),
			0,
		);
		assert.equal(await hoverName.locator(".gs-tabrail-thumbnail").count(), 1);
		assert.equal(
			await production
				.locator(".gs-agent-status-ring")
				.first()
				.evaluate((e) => getComputedStyle(e).width),
			"28px",
		);
		assert.equal(
			await production
				.locator(".gs-tabrail")
				.evaluate((e) => getComputedStyle(e).borderTopWidth),
			"1px",
		);
		await page.waitForTimeout(250);
		assert.deepEqual(
			await tabTargets(),
			beforeHover,
			"Hover must not move any tab target",
		);
		const nameBounds = await hoverName.boundingBox();
		const railBounds = await production.boundingBox();
		assert.ok(
			nameBounds &&
				railBounds &&
				nameBounds.y >= railBounds.y + railBounds.height,
			"Hovered session name must appear beneath the rail",
		);
		assert.equal(
			await production.locator('[data-expanded="true"]').innerText(),
			"GS Edits 1",
		);

		await contained(".production-rail", "New group");
		await production
			.getByRole("button", { name: "Next tabs", exact: true })
			.click();
		await page.waitForFunction(
			() =>
				document.querySelector(".production-rail .gs-tabrail-scroll")
					.scrollLeft > 100,
		);
		await page.waitForFunction(
			() =>
				document.querySelector(".production-rail .gs-tabrail-window").dataset
					.fadeLeft === "true",
		);
		// Wait for the animation to settle, not just a transient passing frame.
		const settledScroll = () =>
			page.locator(".production-rail .gs-tabrail-scroll").evaluate(
				(scroll) =>
					new Promise((resolve) => {
						let last = scroll.scrollLeft,
							stable = 0;
						const tick = () => {
							stable =
								Math.abs(last - scroll.scrollLeft) < 0.5 ? stable + 1 : 0;
							last = scroll.scrollLeft;
							if (stable >= 12) resolve(last);
							else requestAnimationFrame(tick);
						};
						requestAnimationFrame(tick);
					}),
			);
		const afterNext = await settledScroll();
		assert.ok(afterNext > 100, "Next tabs must stay scrolled after hover ends");
		await production
			.getByRole("button", { name: "Previous tabs", exact: true })
			.click();
		assert.ok(
			(await settledScroll()) < afterNext - 80,
			"Previous tabs must scroll backward",
		);
		checks.push(
			"Manual arrow scrolling survives hover exit and smooth-scroll completion",
		);
		await switchTo("GS Edits 1");
		await production
			.getByRole("button", { name: "GS Edits 1", exact: true })
			.focus();
		await page.keyboard.press("End");
		await page.keyboard.press("Enter");
		await page.waitForFunction(
			() =>
				document
					.querySelector('.production-rail [data-active="true"] > button')
					.getAttribute("aria-label") === "GS Edits 17",
		);
		assert.equal(
			await production.getByRole("button", { name: /Find a tab/ }).count(),
			0,
		);
		await contained(".production-rail", "New group");
		await range(720);
		await switchTo("GS Edits 1");
		await production
			.getByRole("button", { name: "GS Edits 1", exact: true })
			.hover();
		const beforeOrder = await production
			.locator("[data-rail-tab]")
			.evaluateAll((els) => els.map((e) => e.dataset.railTab));
		const firstTab = await production
			.locator("[data-rail-tab]")
			.first()
			.boundingBox();
		const thirdTab = await production
			.locator("[data-rail-tab]")
			.nth(2)
			.boundingBox();
		await page.mouse.move(firstTab.x + 15, firstTab.y + firstTab.height / 2);
		await page.mouse.down();
		await page.mouse.move(
			thirdTab.x + thirdTab.width - 5,
			thirdTab.y + thirdTab.height / 2,
			{ steps: 12 },
		);
		await page.mouse.up();
		await page.waitForFunction(
			(before) =>
				document.querySelector(".production-rail [data-rail-tab]").dataset
					.railTab !== before,
			beforeOrder[0],
		);
		checks.push(
			"Production stable hover: names below stationary targets, active label retained, arrow scrolling stays put, directional fades, no count/dropdown, keyboard End/Enter, pointer drag reorder",
		);
		checks.push(
			"Actual production TabRail: 16-17 tabs, permanent + at narrow widths, click creates group",
		);
		await switchTo("GS Edits 1");
		await page.waitForTimeout(1100);
		await production
			.getByRole("button", { name: "GS Edits 1", exact: true })
			.hover();
		const card = page
			.locator(".gs-tabrail-namecard")
			.filter({ hasText: "GS Edits 1" })
			.first();
		await card
			.locator(".gs-tabrail-thumbnail > img")
			.waitFor({ state: "visible" });
		await card
			.getByRole("button", { name: "Open GS Edits 1", exact: true })
			.hover();
		await page.waitForTimeout(400);
		assert.ok(
			await card.isVisible(),
			"Crossing the gap keeps the preview available",
		);
		// Different capture proportions must size the card, not leave empty
		// columns inside a fixed-width image frame. Only the IPC pixels are mocked.
		const capturedImage = card.locator(".gs-tabrail-thumbnail > img");
		const originalCapture = await capturedImage.getAttribute("src");
		for (const width of [688, 480, 320]) {
			await capturedImage.evaluate(async (img, width) => {
				const canvas = document.createElement("canvas");
				canvas.width = width;
				canvas.height = 320;
				const ctx = canvas.getContext("2d");
				ctx.fillStyle = "#282a36";
				ctx.fillRect(0, 0, width, 320);
				ctx.fillStyle = "#8095ff";
				ctx.fillRect(0, 0, 4, 320);
				ctx.fillRect(width - 4, 0, 4, 320);
				ctx.fillStyle = "#f8f8f2";
				ctx.font = "20px sans-serif";
				ctx.fillText("Session preview", 20, 42);
				img.src = canvas.toDataURL("image/png");
				await img.decode();
			}, width);
			const geometry = await card.evaluate((el) => {
				const r = (selector) =>
					el.querySelector(selector).getBoundingClientRect();
				const image = r(".gs-tabrail-thumbnail > img");
				const frame = r(".gs-tabrail-thumbnail");
				const heading = r(".gs-tabrail-preview-heading");
				const identity = r(".gs-tabrail-preview-identity");
				return {
					cardWidth: el.getBoundingClientRect().width,
					imageWidth: image.width,
					imageHeight: image.height,
					gutter: frame.width - image.width,
					centerOffset:
						identity.x + identity.width / 2 - heading.x - heading.width / 2,
				};
			});
			assert.ok(
				Math.abs(geometry.gutter - 2) < 1,
				"Only the thumbnail border surrounds the image",
			);
			assert.ok(
				Math.abs(geometry.centerOffset) < 1,
				"Icon and title are centered independently of Close",
			);
			assert.ok(
				Math.abs(geometry.imageWidth / geometry.imageHeight - width / 320) <
					0.01,
				"Capture is neither stretched nor cropped",
			);
			if (width === 480) {
				assert.ok(
					geometry.cardWidth < 270,
					"Typical session preview shrinks around its pixels",
				);
				await card.screenshot({
					path: resolve(output, "fitted-thumbnail.png"),
				});
			}
		}
		await capturedImage.evaluate(async (img, src) => {
			img.src = src;
			await img.decode();
		}, originalCapture);
		await card.screenshot({ path: resolve(output, "compact-thumbnail.png") });
		await card
			.getByRole("button", { name: "Open GS Edits 1", exact: true })
			.click();
		await card.waitFor({ state: "hidden" });
		await page.evaluate(() => {
			window.thumbnailIdleCaptures = 0;
			window.addEventListener(
				"fixture-thumbnail-capture",
				() => window.thumbnailIdleCaptures++,
			);
		});
		await page.waitForTimeout(1500);
		assert.equal(
			await page.evaluate(() => window.thumbnailIdleCaptures),
			0,
			"No idle thumbnail polling",
		);
		checks.push(
			"Image-fitted thumbnail (simulated IPC), centered identity, neutral 1px rail edge, gap crossing, click to open, no footer or idle capture polling",
		);
		await page.locator(".production-rail").waitFor({ state: "visible" });
		await page.getByLabel("Question scenario").selectOption("single");
		await page.getByLabel("Tab count").selectOption("8");
		await range(650);
		await page.screenshot({
			path: resolve(output, "dark.png"),
			fullPage: true,
		});
		await page.getByRole("button", { name: "Light theme" }).click();
		await page.screenshot({
			path: resolve(output, "light.png"),
			fullPage: true,
		});
		await page.getByRole("button", { name: "Dark theme" }).click();
		await page.emulateMedia({ reducedMotion: "reduce" });
		await page.setViewportSize({ width: 390, height: 900 });
		assert.ok(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= innerWidth,
			),
		);
		await contained(".concept-rail", "New tab");
		await page.screenshot({
			path: resolve(output, "narrow.png"),
			fullPage: true,
		});
		assert.deepEqual(errors, []);
		checks.push(
			"Dark/light/narrow screenshots; reduced motion; no page overflow or browser errors",
		);
		await page.setViewportSize({ width: 1200, height: 900 });
		await range(720);
		for (
			let remaining = await production.locator("[data-rail-tab]").count();
			remaining > 3;
			remaining--
		) {
			await production
				.locator("[data-rail-tab] > button:first-of-type")
				.first()
				.click();
			await production
				.locator("[data-active=true] > .gs-tabrail-close")
				.click();
			await page.waitForFunction(
				(remaining) =>
					document.querySelectorAll(".production-rail [data-rail-tab]").length <
					remaining,
				remaining,
				{ timeout: 2000 },
			);
		}
		await page.waitForTimeout(300);
		const fit = await production.locator(".gs-tabrail").evaluate((e) => {
			const right = e
				.querySelector(".gs-tabrail-fixed")
				.getBoundingClientRect().right;
			return {
				width: e.getBoundingClientRect().width,
				trailing: e.getBoundingClientRect().right - right,
			};
		});
		assert.ok(
			fit.width < 450 && fit.trailing < 10,
			"Three tabs shrink to fit, without trailing filler",
		);
		assert.equal(
			await production
				.getByRole("button", { name: "Next tabs", exact: true })
				.count(),
			0,
		);
		await production.screenshot({
			path: resolve(output, "fit-three-tabs.png"),
		});
		checks.push(
			"Three-tab rail shrinks to its contents and hides unnecessary overflow arrows",
		);
		await writeFile(
			resolve(output, "results.json"),
			JSON.stringify(
				{ ok: true, packagedStyles: packaged, checks, errors },
				null,
				2,
			),
		);
		console.log(JSON.stringify({ ok: true, checks }));
	} catch (error) {
		await writeFile(
			resolve(output, "results.json"),
			JSON.stringify(
				{
					ok: false,
					packagedStyles: packaged,
					checks,
					errors,
					failure: String(error),
				},
				null,
				2,
			),
		);
		await page.screenshot({
			path: resolve(output, "failure.png"),
			fullPage: true,
		});
		console.error(
			await page.locator(".production-rail").evaluateAll((roots) =>
				roots.map((root) => ({
					expanded: [...root.querySelectorAll('[data-expanded="true"]')].map(
						(e) => e.textContent,
					),
					active: root.querySelector('[data-active="true"]')?.textContent,
					scroll: root.querySelector(".gs-tabrail-scroll")?.scrollLeft,
				})),
			),
		);
		throw error;
	} finally {
		await browser.close();
		server.close();
	}
}
