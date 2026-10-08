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
		const assets = resolve(desktop, "dist/renderer/assets");
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
		await page.getByLabel("Agent filter").selectOption("all");
		await page.waitForFunction(
			() => document.querySelectorAll(".collection-session-row").length === 3,
		);
		assert.equal(await page.locator(".session-project-section").count(), 2);
		await page.getByLabel("Actions for Filtrsoft reliability audit").click();
		await page
			.getByRole("menuitem", { name: "Pin session", exact: true })
			.click();
		await page.getByLabel("Agent filter").selectOption("claude");
		await page.getByLabel("Session filter").selectOption("pinned");
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
		await page.getByLabel("Session filter").selectOption("archived");
		await page.getByLabel("Actions for Filtrsoft follow-up").click();
		await page
			.getByRole("menuitem", { name: "Restore session", exact: true })
			.click();
		await page.getByLabel("Session filter").selectOption("all");
		await page.getByLabel("Agent filter").selectOption("all");
		await page.getByLabel("Search sessions").fill("superset");
		await page.waitForFunction(
			() => document.querySelectorAll(".collection-session-row").length === 2,
		);
		await page.getByLabel("Clear search").click();
		await page.getByLabel("Session filter").selectOption("working");
		await page.waitForFunction(
			() => document.querySelectorAll(".collection-session-row").length === 1,
		);
		await page.getByLabel("Session filter").selectOption("all");
		await page.getByLabel("Actions for Filtrsoft follow-up").waitFor();
		checks.push(
			"Production session collections: Claude pin, rename, archive/restore, project search, activity filter",
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
