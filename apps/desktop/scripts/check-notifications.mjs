import assert from "node:assert/strict";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { build } from "vite";

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(desktop, "../../.tmp/notification-preview");
await mkdir(output, { recursive: true });
await build({
	configFile: false,
	envFile: false,
	logLevel: "warn",
	define: { "process.env.NODE_ENV": JSON.stringify("production") },
	plugins: [react(), tailwindcss()],
	resolve: { alias: { shared: resolve(desktop, "src/shared") } },
	build: {
		outDir: output,
		emptyOutDir: false,
		lib: {
			entry: resolve(desktop, "scripts/notification-preview/renderer.tsx"),
			formats: ["iife"],
			name: "NotificationPreview",
			fileName: () => "renderer.js",
			cssFileName: "style",
		},
	},
});
await writeFile(
	resolve(output, "index.html"),
	'<!doctype html><html><head><meta charset="utf-8"><title>GatedSpace session status</title><link rel="stylesheet" href="/style.css"></head><body><script src="/renderer.js"></script></body></html>',
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
	if (name === "style.css" && process.env.NOTIFICATION_PACKAGED) {
		const assets = resolve(desktop, "dist/renderer/assets");
		res.end(
			(
				await Promise.all(
					(
						await readdir(assets)
					)
						.filter(
							(file) =>
								file.endsWith(".css") && !file.startsWith("computer-overlay-"),
						)
						.map((file) => readFile(resolve(assets, file), "utf8")),
				)
			).join("\n"),
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
	const page = await browser.newPage({ viewport: { width: 650, height: 400 } });
	const errors = [];
	page.on("pageerror", (e) => {
		errors.push(e.message);
		console.error(e.message);
	});
	try {
		await page.goto(url);
		const checks = [];
		for (const [label, state] of [
			["Working", "working"],
			["Needs your reply", "permission"],
			["Complete", "review"],
			["Idle", "idle"],
		]) {
			await page.getByRole("button", { name: label, exact: true }).click();
			const rings = page.locator("[data-agent-status]");
			assert.equal(await rings.count(), 2);
			const style = await rings.evaluateAll((nodes) =>
				nodes.map((el) => ({
					state: el.dataset.agentStatus,
					animation: getComputedStyle(el, "::after").animationName,
					shadow: getComputedStyle(el).boxShadow,
					iconOpacity: getComputedStyle(el.querySelector("img")).opacity,
				})),
			);
			for (const r of style) {
				assert.equal(r.state, state);
				assert.equal(
					r.animation,
					state === "working" ? "gs-agent-breathe" : "none",
				);
				assert.equal(r.iconOpacity, "1");
				if (state === "permission" || state === "review")
					assert.notEqual(r.shadow, "none");
			}
			checks.push({ state, style });
			await page.screenshot({ path: resolve(output, `${state}.png`) });
		}
		await page.getByRole("button", { name: "Working", exact: true }).click();
		await page.emulateMedia({ reducedMotion: "reduce" });
		assert.equal(
			await page
				.locator("[data-agent-status]")
				.first()
				.evaluate((el) => getComputedStyle(el, "::after").animationName),
			"none",
		);
		assert.deepEqual(errors, []);
		await writeFile(
			resolve(output, "results.json"),
			JSON.stringify(
				{ passed: true, checks, reducedMotion: true, errors },
				null,
				2,
			),
		);
		console.log(
			"Both providers: 4 states, stable icons, reduced motion and zero page errors passed.",
		);
	} finally {
		await browser.close();
		server.close();
	}
}
