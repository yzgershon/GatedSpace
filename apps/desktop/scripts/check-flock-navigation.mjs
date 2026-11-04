import assert from "node:assert/strict";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { build } from "vite";

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(desktop, "../../.tmp/flock-navigation-preview");
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
				"renderer/lib/electron-trpc",
				"renderer/lib/trpc-client",
				"renderer/routes/_authenticated/providers/CollectionsProvider",
				"renderer/components/EnsembleWorkspace/open-ensemble-session",
				"renderer/routes/_authenticated/_dashboard/components/UsageDialog/UsageDialog",
			].map((find) => ({
				find,
				replacement: resolve(
					desktop,
					"scripts/flock-navigation-preview/mock.tsx",
				),
			})),
			{ find: "renderer", replacement: resolve(desktop, "src/renderer") },
			{ find: "shared", replacement: resolve(desktop, "src/shared") },
		],
	},
	build: {
		outDir: output,
		emptyOutDir: false,
		lib: {
			entry: resolve(desktop, "scripts/flock-navigation-preview/renderer.tsx"),
			formats: ["iife"],
			name: "FlockNavigationPreview",
			fileName: () => "renderer.js",
			cssFileName: "style",
		},
	},
});
await writeFile(
	resolve(output, "index.html"),
	'<!doctype html><html><head><meta charset="utf-8"><title>Flock navigation verification</title><link rel="stylesheet" href="./style.css"></head><body><script src="./renderer.js"></script></body></html>',
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
	if (name === "style.css" && process.env.FLOCK_PACKAGED) {
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
if (process.argv.includes("--serve")) console.log(url);
else {
	const { chromium } = await import(
		process.env.PLAYWRIGHT_MODULE ?? "playwright"
	);
	const browser = await chromium.launch({ channel: "msedge", headless: true });
	const page = await browser.newPage({
		viewport: { width: 1280, height: 900 },
	});
	page.setDefaultTimeout(10000);
	const errors = [];
	const checks = [];
	page.on("pageerror", (error) => errors.push(error.message));
	const flock = () =>
		page.getByRole("button", {
			name: "Flock · collaborative teams",
			exact: true,
		});
	const recent = () =>
		page.getByRole("button", { name: "Recent sessions", exact: true });
	try {
		await page.goto(`${url}/?direct`);
		assert.equal(
			Math.round(
				(
					await page
						.locator("#direct-embedding .ensemble-workspace")
						.boundingBox()
				).width,
			),
			900,
		);
		checks.push(
			"Flock fills a dashboard row flexbox instead of collapsing to zero width",
		);
		await page.goto(url);
		await page.getByLabel("Session draft").fill("Keep this unsent message");
		await page.keyboard.press("Control+Shift+K");
		assert.equal(
			await page.evaluate(() => window.flockTest.probe.shortcutInvocations),
			1,
		);
		await flock().click();
		await page
			.getByRole("heading", { name: "Give the team a mission" })
			.waitFor();
		assert.equal(
			await page.evaluate(() => window.flockTest.location().pathname),
			"/v2-workspace/current",
		);
		assert.equal(
			await page.locator('[data-testid="shortcuts"]').textContent(),
			"false",
		);
		await page.keyboard.press("Control+Shift+K");
		assert.equal(
			await page.evaluate(() => window.flockTest.probe.shortcutInvocations),
			1,
		);
		await page
			.getByLabel("Goal", { exact: true })
			.fill("Create a shared reading list");
		await page
			.getByLabel("Definition of done", { exact: true })
			.fill("A reviewed list with three useful sources");
		for (let i = 0; i < 4; i++) {
			await recent().click();
			await page.getByLabel("Session draft").waitFor();
			assert.equal(
				await page.getByLabel("Session draft").inputValue(),
				"Keep this unsent message",
			);
			assert.equal(
				await page.locator('[data-testid="shortcuts"]').textContent(),
				"true",
			);
			await page.waitForFunction(
				() => window.flockTest.probe.activeStreams === 0,
			);
			await page.keyboard.press("Control+Shift+K");
			assert.equal(
				await page.evaluate(() => window.flockTest.probe.shortcutInvocations),
				i + 2,
			);
			await flock().click();
			assert.equal(
				await page.getByLabel("Goal", { exact: true }).inputValue(),
				"Create a shared reading list",
			);
		}
		assert.deepEqual(
			await page.evaluate(() => [
				window.flockTest.probe.workspaceMounts,
				window.flockTest.probe.workspaceUnmounts,
				window.flockTest.probe.activeStreams,
			]),
			[1, 0, 1],
		);
		checks.push(
			"Four round trips preserve the workspace instance, session draft and Flock draft; hidden shortcuts and subscriptions stop",
		);
		await page.evaluate(() => window.flockTest.history.back());
		await page.getByLabel("Session draft").waitFor();
		await page.evaluate(() => window.flockTest.history.forward());
		await page.getByLabel("Goal", { exact: true }).waitFor();
		checks.push("Back and Forward switch views without remounting the session");
		for (const width of [1500, 1100, 800]) {
			await page.setViewportSize({ width, height: 900 });
			const view = await page
				.getByRole("region", { name: "Flock workspace", exact: true })
				.boundingBox();
			const root = await page.locator(".ensemble-workspace").boundingBox();
			assert.ok(root.width > 400 && Math.abs(root.width - view.width) < 2);
			assert.ok(root.x + root.width <= width + 1);
			await page.screenshot({ path: resolve(output, `flock-${width}.png`) });
		}
		checks.push(
			"Full-width visible Flock at 800, 1100 and 1500px window widths",
		);
		await page.getByRole("button", { name: "Close team setup" }).click();
		await page.getByLabel("Session draft").waitFor();
		checks.push("Closing empty-team setup returns to the preserved session");
		await page.goto(`${url}/?mode=pending`);
		await flock().click();
		await page
			.getByRole("status")
			.filter({ hasText: "Opening Flock" })
			.waitFor();
		await recent().click();
		await page.getByLabel("Session draft").waitFor();
		checks.push("Pending Flock data never blocks returning to sessions");
		await page.goto(`${url}/?mode=error`);
		await flock().click();
		await page
			.getByRole("alert")
			.filter({ hasText: "Test connection unavailable" })
			.waitFor();
		await page.evaluate(() => {
			window.flockTest.probe.mode = "ready";
		});
		await page.getByRole("button", { name: "Try again" }).click();
		await page.getByLabel("Goal", { exact: true }).waitFor();
		checks.push(
			"Connection error is readable and retry recovers without reloading the app",
		);
		await page.goto(`${url}/?mode=crash`);
		await flock().click();
		await page
			.getByRole("alert")
			.filter({ hasText: "Flock couldn't display" })
			.waitFor();
		await recent().click();
		await page.getByLabel("Session draft").waitFor();
		await page.evaluate(() => window.flockTest.recover());
		await flock().click();
		await page.getByRole("button", { name: "Try again" }).click();
		await page.getByLabel("Goal", { exact: true }).waitFor();
		checks.push(
			"Flock render failure stays isolated; sessions remain usable and retry recovers",
		);
		await page.goto(`${url}/?legacy`);
		await page.getByLabel("Goal", { exact: true }).waitFor();
		assert.equal(await page.locator(".ensemble-workspace").count(), 1);
		assert.equal(
			await page.evaluate(() => window.flockTest.probe.activeStreams),
			1,
		);
		await recent().click();
		await page.getByLabel("Session draft").waitFor();
		checks.push(
			"Persisted /ensemble locations open one Flock instance and can return to sessions",
		);
		assert.deepEqual(errors, []);
		await writeFile(
			resolve(output, "results.json"),
			JSON.stringify(
				{
					checks,
					errors,
					evidence:
						"Real renderer components with simulated IPC and session content; no provider work launched",
				},
				null,
				2,
			),
		);
		console.log(JSON.stringify({ checks, errors }, null, 2));
	} catch (error) {
		await page.screenshot({ path: resolve(output, "failed.png") });
		await writeFile(resolve(output, "failed.html"), await page.content());
		console.error({ errors });
		throw error;
	} finally {
		await browser.close();
		server.close();
	}
}
