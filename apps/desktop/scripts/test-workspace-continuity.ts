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
process.chdir(resolve(import.meta.dirname, ".."));
const out = resolve("../../.tmp/workspace-continuity-ui");
await mkdir(out, { recursive: true });
if (!process.env.SKIP_UI_BUILD)
	await build({
		configFile: false,
		envFile: false,
		logLevel: "warn",
		plugins: [
			react(),
			tailwindcss(),
			{
				name: "fixtures",
				enforce: "pre",
				resolveId(id) {
					if (
						id ===
						"renderer/routes/_authenticated/providers/LocalHostServiceProvider"
					)
						return "\0local-host";
					if (id === "renderer/lib/host-trpc-client") return "\0host-client";
				},
				load(id) {
					if (/LocalHostServiceProvider[/\\]index\.ts$/.test(id))
						return 'export function useLocalHostService(){return {activeHostUrl:"fixture"}}';
					if (/[/\\]host-trpc-client\.ts$/.test(id))
						return "export function getHostTrpcClient(){return {terminalAgents:{list:{query:async()=>[]}}}}";
					if (id === "\0local-host")
						return 'export function useLocalHostService(){return {activeHostUrl:"fixture"}}';
					if (id === "\0host-client")
						return "export function getHostTrpcClient(){return {terminalAgents:{list:{query:async()=>[]}}}}";
					if (/[/\\]renderer[/\\]lib[/\\]trpc-client\.ts$/.test(id))
						return readFile(
							resolve("scripts/workspace-continuity/fixture-client.ts"),
							"utf8",
						);
				},
			},
		],
		resolve: {
			alias: {
				renderer: resolve("src/renderer"),
				shared: resolve("src/shared"),
			},
		},
		define: { "process.env": "{}", "process.platform": '"win32"' },
		build: {
			outDir: out,
			emptyOutDir: false,
			minify: false,
			lib: {
				entry: resolve("scripts/workspace-continuity/renderer.tsx"),
				formats: ["iife"],
				name: "ContinuityFixture",
				fileName: () => "renderer.js",
				cssFileName: "style",
			},
		},
	});
await writeFile(
	resolve(out, "index.html"),
	'<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/style.css"></head><body><script src="/renderer.js"></script></body></html>',
);
const server = createServer(async (req, res) => {
	const path = req.url === "/" ? "index.html" : req.url?.slice(1);
	if (!["index.html", "renderer.js", "style.css"].includes(path ?? "")) {
		res.writeHead(404).end();
		return;
	}
	res.setHeader(
		"Content-Type",
		path?.endsWith(".js")
			? "text/javascript"
			: path?.endsWith(".css")
				? "text/css"
				: "text/html",
	);
	res.end(await readFile(resolve(out, path ?? "index.html")));
});
await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
const browser = await chromium.launch({ channel: "chrome", headless: true });
const errors: string[] = [];
const checks: string[] = [];
try {
	const page = await browser.newPage({
		viewport: { width: 1000, height: 760 },
		deviceScaleFactor: 1.5,
	});
	page.on("pageerror", (e) => {
		errors.push(e.message);
		console.error(e.message);
	});
	await page.goto(
		`http://127.0.0.1:${(server.address() as { port: number }).port}`,
	);
	await page.getByText("Pinned", { exact: true }).waitFor();
	assert.equal(await page.locator(".lucide-bot").count(), 3);
	checks.push("assistant icons use theme styling; no letter badges");
	await page.getByText("App edits", { exact: true }).click();
	const request = JSON.parse(await page.locator("output").innerText());
	assert.equal(request.mode, "resume");
	assert.equal(request.sessionId, "00000000-0000-4000-8000-000000000001");
	assert.equal(request.cwd, "C:/Dev");
	checks.push("pinned session opens original identity and directory");
	await page.getByRole("textbox").fill("Research");
	await page.getByText("Research", { exact: true }).last().waitFor();
	assert.equal(await page.getByText("App edits", { exact: true }).count(), 0);
	checks.push("search finds pinned sessions");
	await page.getByRole("textbox").fill("");
	await page.getByText("App edits", { exact: true }).waitFor();
	await page.getByText("App edits", { exact: true }).click({ button: "right" });
	await page.getByRole("menuitem", { name: "Unpin session" }).click();
	await page.getByText("App edits", { exact: true }).click({ button: "right" });
	await page
		.getByRole("menuitem", { name: "Pin session", exact: true })
		.waitFor();
	await page.keyboard.press("Escape");
	checks.push("context menu pin and unpin work");
	await page.reload();
	await page.getByText("Research", { exact: true }).last().waitFor();
	assert.equal(
		await page.evaluate(() =>
			localStorage.getItem("gatedspace-session-provider"),
		),
		"codex",
	);
	checks.push("Codex provider choice persists");
	await page.screenshot({ path: resolve(out, "sidebar.png") });
	assert.deepEqual(errors, []);
	await writeFile(
		resolve(out, "results.json"),
		JSON.stringify({ checks, errors }, null, 2),
	);
	console.log(JSON.stringify({ checks, errors }));
} catch (error) {
	console.error(
		JSON.stringify({
			errors,
			inputs: await browser
				.contexts()[0]
				?.pages()[0]
				?.locator("input")
				.evaluateAll((nodes) => nodes.map((n) => n.outerHTML)),
			body: await browser
				.contexts()[0]
				?.pages()[0]
				?.locator("body")
				.innerText(),
		}),
	);
	throw error;
} finally {
	await browser.close();
	server.close();
}
