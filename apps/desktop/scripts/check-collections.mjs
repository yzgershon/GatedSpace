import assert from "node:assert/strict";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { build } from "vite";

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(desktop, "../../.tmp/collections-preview");
await mkdir(output, { recursive: true });
await build({
	configFile: false,
	envFile: false,
	logLevel: "warn",
	define: { "process.env.NODE_ENV": JSON.stringify("production") },
	plugins: [react(), tailwindcss()],
	resolve: {
		alias: [
			...[
				"renderer/lib/trpc-client",
				"renderer/routes/_authenticated/_dashboard/components/UsageDialog/UsageDialog",
				"renderer/lib/host-trpc-client",
				"renderer/hooks/useCopyToClipboard",
				"renderer/assets/app-icons/preset-icons",
				"renderer/routes/_authenticated/providers/LocalHostServiceProvider",
			].map((find) => ({
				find,
				replacement: resolve(desktop, "scripts/collections-preview/mock.ts"),
			})),
			{ find: "renderer", replacement: resolve(desktop, "src/renderer") },
			{ find: "shared", replacement: resolve(desktop, "src/shared") },
		],
	},
	build: {
		outDir: output,
		emptyOutDir: false,
		lib: {
			entry: resolve(desktop, "scripts/collections-preview/renderer.tsx"),
			formats: ["iife"],
			name: "CollectionsPreview",
			fileName: () => "renderer.js",
			cssFileName: "style",
		},
	},
});
await writeFile(
	resolve(output, "index.html"),
	'<!doctype html><html><head><meta charset="utf-8"><title>GatedSpace Collections</title><link rel="stylesheet" href="/style.css"></head><body><script src="/renderer.js"></script></body></html>',
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
	if (name === "style.css" && process.env.COLLECTIONS_PACKAGED) {
		const assets = process.env.COLLECTIONS_STYLE_DIR
			? resolve(process.env.COLLECTIONS_STYLE_DIR)
			: resolve(desktop, "dist/renderer/assets");
		res.end(
			`${(
				await Promise.all(
					(await readdir(assets))
						.filter(
							(file) =>
								file.endsWith(".css") && !file.startsWith("computer-overlay-"),
						)
						.map((file) => readFile(resolve(assets, file), "utf8")),
				)
			).join(
				"\n",
			)}\n${await readFile(resolve(desktop, "scripts/collections-preview/style.css"), "utf8")}`,
		);
	} else res.end(await readFile(resolve(output, name)));
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const url = `http://127.0.0.1:${server.address().port}`;
console.log(url);
await writeFile(resolve(output, "url.txt"), url);
if (!process.argv.includes("--serve")) {
	const { chromium } = await import(
		process.env.PLAYWRIGHT_MODULE ?? "playwright"
	);
	const browser = await chromium.launch({ channel: "chrome", headless: true });
	const page = await browser.newPage({
		viewport: { width: 1150, height: 900 },
	});
	const errors = [];
	const checks = [];
	page.on("pageerror", (e) => errors.push(e.message));
	try {
		await page.goto(url);
		// Exercise the real Workspaces controls too: the session-toolbar redesign
		// previously removed their shared styles without any workspace coverage.
		const workspace = page.locator(".check-project");
		const activeFilter = workspace.getByRole("button", {
			name: "Active only",
			exact: true,
		});
		const search = workspace.getByRole("textbox", {
			name: "Search workspaces",
		});
		await search.fill("unmatched branch");
		assert.equal(
			await workspace
				.locator(".workspace-collection-filters > span")
				.textContent(),
			"0 projects",
		);
		await workspace
			.getByRole("button", { name: "Clear workspace search" })
			.click();
		assert.equal(await search.inputValue(), "");
		assert.equal(
			await workspace
				.locator(".workspace-collection-filters > span")
				.textContent(),
			"1 project",
		);
		await activeFilter.click();
		assert.equal(await activeFilter.getAttribute("aria-pressed"), "true");
		await activeFilter.press("Space");
		assert.equal(await activeFilter.getAttribute("aria-pressed"), "false");
		assert.equal(await activeFilter.innerText(), "Active only");
		await page.setViewportSize({ width: 1600, height: 1100 });
		for (const zoom of [1, 1.25, 1.5, 2]) {
			for (const width of [220, 260, 320]) {
				await workspace.evaluate(
					(el, { width, zoom }) => {
						el.style.width = `${width}px`;
						el.style.maxWidth = "none";
						el.style.zoom = String(zoom);
					},
					{ width, zoom },
				);
				const geometry = await workspace.evaluate((el) => {
					const controls = el.querySelector(".workspace-collection-controls");
					const row = el.querySelector(".workspace-collection-filters");
					const count = row.querySelector("span");
					const button = row.querySelector("button");
					const c = count.getBoundingClientRect(),
						b = button.getBoundingClientRect(),
						r = controls.getBoundingClientRect();
					const hit = document.elementFromPoint(
						b.x + b.width / 2,
						b.y + b.height / 2,
					);
					return {
						gap: b.left - c.right,
						sameRow: c.top >= b.top && c.bottom <= b.bottom,
						contained: c.left >= r.left && b.right <= r.right,
						fontSize: Number.parseFloat(getComputedStyle(count).fontSize),
						overflow: controls.scrollWidth > controls.clientWidth,
						clickable: button === hit || button.contains(hit),
					};
				});
				assert.ok(
					geometry.gap >= 8 * zoom &&
						geometry.sameRow &&
						geometry.contained &&
						geometry.clickable &&
						!geometry.overflow &&
						geometry.fontSize <= 12,
					`Workspace toolbar layout at ${width}px/${zoom}: ${JSON.stringify(geometry)}`,
				);
				if (width === 260)
					await workspace.screenshot({
						path: resolve(output, `workspace-controls-${zoom}.png`),
					});
			}
		}
		await workspace.evaluate((el) => {
			el.style.width = "";
			el.style.maxWidth = "";
			el.style.zoom = "";
		});
		await page.setViewportSize({ width: 1150, height: 900 });
		checks.push(
			"Real workspace search/clear and active-toggle keyboard behavior; separate count/filter at 220/260/320px and 100/125/150/200% zoom",
		);

		for (const name of ["Workspaces · 2", "Recent sessions", "Usage"]) {
			await page.getByRole("button", { name, exact: true }).hover();
			const tip = page.locator(
				'.dashboard-sidebar-nav-tooltip[data-state="delayed-open"], .dashboard-sidebar-nav-tooltip[data-state="instant-open"]',
			);
			await tip.waitFor({ state: "visible" });
			await page.waitForTimeout(250);
			assert.equal(await tip.locator("svg").count(), 0);
			const box = await tip.boundingBox();
			assert.ok(box && box.width > 50 && box.height >= 28);
			await page.screenshot({
				path: resolve(output, `tooltip-${name.split(" ")[0]}.png`),
			});
			await page.mouse.move(1140, 880);
		}

		await page.waitForFunction(
			() => document.querySelectorAll(".collection-session-row").length === 3,
		);
		assert.equal(await page.locator(".session-project-section").count(), 2);
		await page.getByLabel("Actions for Filtrsoft reliability audit").click();
		await page
			.getByRole("menuitem", { name: "Pin session", exact: true })
			.click();
		await page
			.getByRole("button", { name: "Claude sessions", exact: true })
			.click();

		await page.waitForFunction(() =>
			document
				.querySelector('[data-group="@pinned"]')
				?.textContent.includes("Filtrsoft"),
		);
		await page.getByLabel("Actions for Filtrsoft reliability audit").click();
		await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
		await page
			.getByLabel("Rename Filtrsoft reliability audit")
			.fill("Filtrsoft follow-up");
		await page.getByLabel("Rename Filtrsoft reliability audit").press("Enter");
		await page.getByLabel("Actions for Filtrsoft follow-up").click();
		await page
			.getByRole("menuitem", { name: "Archive session", exact: true })
			.click();
		await page.getByLabel("Archived sessions", { exact: true }).click();
		await page.getByLabel("Actions for Filtrsoft follow-up").click();
		await page
			.getByRole("menuitem", { name: "Restore session", exact: true })
			.click();
		await page.getByLabel("Archived sessions", { exact: true }).click();

		await page
			.getByRole("button", { name: "Claude sessions", exact: true })
			.click();
		assert.equal(
			await page
				.getByRole("button", { name: "Claude sessions", exact: true })
				.getAttribute("aria-pressed"),
			"false",
		);
		assert.equal(await page.locator("select").count(), 0);
		assert.equal(await page.getByText("YOUR LIBRARY").count(), 0);
		await page.getByLabel("Search sessions").fill("superset");
		await page.waitForFunction(
			() => document.querySelectorAll(".collection-session-row").length === 2,
		);
		await page.getByLabel("Clear search").click();
		await page.getByLabel("Actions for Filtrsoft follow-up").waitFor();
		checks.push(
			"Production session collections: Claude pin, rename, archive/restore, project search, compact provider toggles",
		);
		for (const provider of ["Codex", "Claude"]) {
			await page
				.getByRole("button", { name: `${provider} composer`, exact: true })
				.click();
			await page.getByLabel("Message draft").fill("Unsent draft to preserve");
			await page.getByLabel("Edit queued message 1").click();
			assert.equal(await page.locator("textarea").count(), 1);
			assert.equal(
				await page.getByLabel("Message draft").inputValue(),
				"Check the narrow pane layout too.",
			);
			await page
				.getByLabel("Message draft", { exact: true })
				.fill("Edited queued prompt");
			await page.screenshot({
				path: resolve(output, `${provider}-queue-edit.png`),
			});
			await page
				.getByRole("button", { name: "Save queued message", exact: true })
				.click();
			assert.match(
				await page.getByLabel("Edit queued message 1").innerText(),
				/Edited queued prompt/,
			);
			assert.equal(
				await page.getByLabel("Message draft").inputValue(),
				"Unsent draft to preserve",
			);
			await page.getByLabel("Edit queued message 1").click();
			await page.getByLabel("Message draft").fill("Discard this edit");
			await page
				.getByRole("button", { name: "Cancel edit", exact: true })
				.click();
			assert.equal(
				await page.getByLabel("Message draft").inputValue(),
				"Unsent draft to preserve",
			);
			for (const message of ["Next follow-up", "Third follow-up"]) {
				await page.getByLabel("Message draft").fill(message);
				await page
					.getByRole("button", { name: "Queue message", exact: true })
					.click();
			}
			assert.equal(await page.locator(".message-queue-row").count(), 2);
			await page
				.getByRole("button", { name: "1 more queued", exact: true })
				.click();
			assert.equal(await page.locator(".message-queue-row").count(), 3);
			await page.getByLabel("Delete queued message 2").click();
			await page.getByLabel("Send queued message 1 now").click();
			assert.match(
				await page.getByLabel("Edit queued message 1").innerText(),
				/Third follow-up/,
			);
			const geometry = await page.evaluate(() => {
				const q = document
					.querySelector(".session-message-queue")
					.getBoundingClientRect();
				const c = document
					.querySelector(".session-composer")
					.getBoundingClientRect();
				const r = document
					.querySelector(".message-queue-row")
					.getBoundingClientRect();
				return {
					overlap: q.bottom - c.top,
					visibleHeight: c.top - q.top,
					rowBottom: r.bottom - c.top,
				};
			});
			assert.ok(
				geometry.overlap >= 15 && geometry.overlap <= 18,
				JSON.stringify(geometry),
			);
			assert.ok(
				geometry.visibleHeight >= 32 && geometry.visibleHeight <= 46,
				JSON.stringify(geometry),
			);
			assert.ok(geometry.rowBottom <= 0, JSON.stringify(geometry));
			checks.push({
				provider,
				queue: "edit, pause while editing, save, append, expand, delete, steer",
				geometry,
			});
		}
		// Provider toggles must return to all rather than trapping the last filter.
		for (const agent of ["Codex", "Claude"]) {
			await page
				.getByRole("button", { name: `${agent} sessions`, exact: true })
				.click();
			assert.equal(
				await page
					.getByRole("button", { name: `${agent} sessions`, exact: true })
					.getAttribute("aria-pressed"),
				"true",
			);
			await page
				.getByRole("button", { name: `${agent} sessions`, exact: true })
				.click();
			assert.equal(
				await page
					.getByRole("button", { name: `${agent} sessions`, exact: true })
					.getAttribute("aria-pressed"),
				"false",
			);
		}
		for (const width of [280, 320, 390, 480, 560, 640]) {
			await page.setViewportSize({ width: 1150, height: 1000 });
			await page
				.locator(".tool-tabs-fixture")
				.evaluate((el, w) => (el.style.width = `${w}px`), width);
			await page.waitForTimeout(100);
			const panel = page.getByRole("region", { name: "Right tools" });
			const add = page.getByRole("button", {
				name: "Add right tool",
				exact: true,
			});
			const geometry = await add.evaluate((el) => {
				const a = el.getBoundingClientRect(),
					p = el.closest(".gs-tool-panel").getBoundingClientRect();
				return { visible: a.left >= p.left && a.right <= p.right };
			});
			assert.ok(geometry.visible, `Add clipped at ${width}`);
			if (
				(await page
					.getByRole("button", { name: "Previous tool tabs" })
					.isVisible()) &&
				(await page
					.getByRole("button", { name: "Previous tool tabs" })
					.isEnabled())
			)
				await page.getByRole("button", { name: "Previous tool tabs" }).click();
			await page.waitForTimeout(350);
			const countVisible = () =>
				page.locator(".gs-tool-tab-list").evaluate((el) => {
					const r = el.getBoundingClientRect();
					return [...el.querySelectorAll("[role=tab]")].filter((t) => {
						const b = t.getBoundingClientRect();
						return b.left >= r.left - 1 && b.right <= r.right + 1;
					}).length;
				});
			assert.ok(
				(await countVisible()) >= (width >= 480 ? 3 : 1),
				`Too few readable tabs at ${width}`,
			);
			if (
				(await page
					.getByRole("button", { name: "Next tool tabs" })
					.isVisible()) &&
				(await page.getByRole("button", { name: "Next tool tabs" }).isEnabled())
			)
				await page.getByRole("button", { name: "Next tool tabs" }).click();
			await page.waitForTimeout(350);
			assert.ok(
				(await countVisible()) >= (width >= 480 ? 3 : 1),
				`Too few readable tabs after scrolling forward at ${width}`,
			);
			assert.equal(await panel.locator(".gs-tool-tab").count(), 9);
			assert.equal(await panel.locator(".gs-tool-tab-title").count(), 9);
			assert.ok(
				await panel
					.locator(".gs-tool-tab-title")
					.evaluateAll((labels) =>
						labels.every(
							(el) =>
								el.textContent.length > 4 &&
								el.getBoundingClientRect().width >= 40,
						),
					),
			);
			await page.locator(".tool-tabs-fixture").screenshot({
				path: resolve(output, `tabs-${width}.png`),
			});
		}
		await page
			.locator(".tool-tabs-fixture")
			.evaluate((el) => (el.style.width = "100%"));
		checks.push(
			"Compact navigation, provider toggle-to-all, every preview tab titled; 3 complete tabs at 480/560/640px with pinned Add",
		);

		for (const width of [380, 520, 800, 1150]) {
			await page.setViewportSize({ width, height: 1000 });
			await page.waitForTimeout(80);
			assert.ok(
				await page.evaluate(
					() => document.documentElement.scrollWidth <= innerWidth,
				),
				`Overflow at ${width}`,
			);
			const rail = page.locator(".check-grid aside");
			assert.ok(
				await rail.evaluate((el) => el.scrollWidth <= el.clientWidth),
				`Sidebar overflow at ${width}`,
			);
			const density = await page.locator(".check-grid aside").evaluate((el) => {
				const nav = el.querySelector('[aria-label="Sidebar navigation"]'),
					row = el.querySelector(".collection-session-row");
				const buttons = [...nav.querySelectorAll("button")].map(
					(b) => b.getBoundingClientRect().width,
				);
				return {
					firstRow:
						row.getBoundingClientRect().top - el.getBoundingClientRect().top,
					widths: buttons,
				};
			});
			assert.ok(density.firstRow < 175, JSON.stringify(density));
			assert.ok(
				Math.max(...density.widths) - Math.min(...density.widths) < 1,
				JSON.stringify(density),
			);
			await page.screenshot({
				path: resolve(output, `collections-${width}.png`),
				fullPage: true,
			});
			checks.push({ width, overflow: false });
		}
		await page.emulateMedia({ reducedMotion: "reduce" });
		assert.equal(
			await page
				.locator('[data-status="working"] .collection-agent-icon')
				.evaluate((el) => getComputedStyle(el).animationName),
			"none",
		);
		assert.deepEqual(errors, []);
		await writeFile(
			resolve(output, "results.json"),
			JSON.stringify({ checks, errors }, null, 2),
		);
		console.log(JSON.stringify({ passed: checks.length, errors }));
	} finally {
		await browser.close();
		server.close();
	}
}
