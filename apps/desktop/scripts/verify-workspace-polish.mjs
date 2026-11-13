import assert from "node:assert/strict";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const app = resolve(import.meta.dirname, "..").replaceAll("\\", "/");
const req = createRequire(`${app}/package.json`);
const { build } = await import(pathToFileURL(req.resolve("vite")));
const { default: react } = await import(
	pathToFileURL(req.resolve("@vitejs/plugin-react"))
);
const { default: tailwind } = await import(
	pathToFileURL(req.resolve("@tailwindcss/vite"))
);
const bunStore = resolve(app, "../../node_modules/.bun");
const playwrightPackage = (await readdir(bunStore)).find((name) =>
	name.startsWith("playwright@"),
);
if (!playwrightPackage)
	throw new Error(
		"Install workspace dependencies before running this browser check.",
	);
const { chromium } = await import(
	pathToFileURL(
		resolve(bunStore, playwrightPackage, "node_modules/playwright/index.mjs"),
	)
);
const out = resolve(app, "../../.tmp/workspace-polish-verification").replaceAll(
	"\\",
	"/",
);
await mkdir(out, { recursive: true });
const fixture = `import {electronTrpcClient as base, electronTrpc as baseHooks} from '${app}/scripts/account-usage-preview/fixture';
export const state={sent:[],version:{version:'1.18.57',isDev:false}};Object.assign(window,{polishFixture:state});
export const electronTrpcClient={...base,codexSession:{...base.codexSession,send:{mutate:async(input)=>{state.sent.push(input);return {};}}},claudeSession:{...base.claudeSession}};
export const electronTrpc={...baseHooks,diagnostics:{appVersion:{useQuery:()=>({data:state.version})}}};`;
const renderer = await readFile(
	`${app}/scripts/workspace-polish/fixture.tsx`,
	"utf8",
);
await writeFile(`${out}/ui-entry.tsx`, renderer);
await build({
	configFile: false,
	envFile: false,
	logLevel: "error",
	plugins: [
		react(),
		tailwind(),
		{
			name: "fixture",
			enforce: "pre",
			resolveId(id) {
				if (id === "virtual:fixture" || id === "virtual:renderer")
					return `\0${id}`;
			},
			load(id) {
				if (id === "\0virtual:fixture") return fixture;
				if (/[/\\]renderer[/\\]lib[/\\]trpc-client\.ts$/.test(id))
					return `export {electronTrpcClient} from 'virtual:fixture'`;
				if (/[/\\]renderer[/\\]lib[/\\]electron-trpc\.ts$/.test(id))
					return `export {electronTrpc} from 'virtual:fixture'`;
				if (id === "\0virtual:renderer") return renderer;
			},
			transform(code, id) {
				if (id === "\0virtual:renderer")
					return import(pathToFileURL(req.resolve("esbuild"))).then(
						({ transform }) =>
							transform(code, { loader: "tsx", jsx: "automatic" }),
					);
			},
		},
	],
	resolve: {
		alias: {
			react: `${app}/node_modules/react`,
			"react-dom": `${app}/node_modules/react-dom`,
			"@superset/ui/tooltip": req.resolve("@superset/ui/tooltip"),
			"@superset/ui/button": req.resolve("@superset/ui/button"),
			"@superset/ui/dialog": req.resolve("@superset/ui/dialog"),
			"@superset/panes": req.resolve("@superset/panes"),
			"react-dnd": req.resolve("react-dnd"),
			"react-dnd-html5-backend": req.resolve("react-dnd-html5-backend"),
			"@tanstack/react-query": req.resolve("@tanstack/react-query"),
			renderer: `${app}/src/renderer`,
			shared: `${app}/src/shared`,
		},
	},
	define: {
		"process.env": "{}",
		"process.platform": JSON.stringify(process.platform),
	},
	build: {
		outDir: out,
		emptyOutDir: false,
		minify: false,
		lib: {
			entry: `${out}/ui-entry.tsx`,
			formats: ["iife"],
			name: "ClaudeModels",
			fileName: () => "ui.js",
			cssFileName: "ui",
		},
	},
});
await writeFile(
	`${out}/index.html`,
	'<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="./ui.css"></head><body style="background:#282a36;color:#f8f8f2"><div id="root"></div><script src="./ui.js"></script></body></html>',
);
const server = createServer(async (req, res) => {
	const f =
		new URL(req.url, "http://localhost").pathname.slice(1) || "index.html";
	if (!["ui.js", "ui.css", "index.html"].includes(f)) {
		res.writeHead(404).end();
		return;
	}
	res.setHeader(
		"Content-Type",
		f.endsWith(".js")
			? "text/javascript"
			: f.endsWith(".css")
				? "text/css"
				: "text/html",
	);
	res.end(await readFile(resolve(out, f)));
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const passed = [];
page.setDefaultTimeout(12000);
try {
	await page.goto(`http://127.0.0.1:${server.address().port}`);
	await page.getByRole("button", { name: "Back to my workspace" }).click();
	assert.equal(
		await page.evaluate(() =>
			localStorage.getItem("gatedspace:whats-new:seen-version"),
		),
		"1.18.57",
	);
	await page.reload();
	await page.getByRole("button", { name: "Tab A", exact: true }).waitFor();
	assert.equal(await page.getByRole("dialog").count(), 0);
	passed.push(
		"Update highlights shown once, dismissed version survives reload",
	);
	await page.getByRole("button", { name: "Release notes" }).click();
	await page.getByRole("dialog").waitFor();
	await page.keyboard.press("Escape");
	await page.locator("[role=dialog]").waitFor({ state: "detached" });
	passed.push("Version action reopens notes, Escape dismisses");
	await page.getByRole("button", { name: "Tab A", exact: true }).click();
	const size = () =>
		page
			.locator('[data-panel-group-id="a:root"] [data-panel]')
			.first()
			.getAttribute("data-panel-size");
	await page.waitForFunction(() =>
		document.querySelector('[data-panel-group-id="a:root"]'),
	);
	const handle = page
		.locator('[data-panel-group-id="a:root"] [data-panel-resize-handle-id]')
		.first();
	const box = await handle.boundingBox();
	const before = await page.evaluate(() => window.polishFixture.writes);
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(box.x + 170, box.y + box.height / 2, { steps: 30 });
	assert.equal(await page.evaluate(() => window.polishFixture.writes), before);
	await page.mouse.up();
	const resized = Number(await size());
	await page.screenshot({ path: `${out}/drag.png` });
	assert.ok(resized > 55);
	assert.ok(
		(await page.evaluate(() => window.polishFixture.writes)) <= before + 1,
	);
	passed.push(
		"Real divider drag updates immediately with one store write at release",
	);
	await page.getByRole("button", { name: "Tab B", exact: true }).click();
	await page.waitForFunction(() =>
		document.querySelector('[data-panel-group-id="b:root"]'),
	);
	assert.ok(
		Math.abs(
			Number(
				await page
					.locator('[data-panel-group-id="b:root"] [data-panel]')
					.first()
					.getAttribute("data-panel-size"),
			) - 35,
		) < 1,
	);
	await page.getByRole("button", { name: "Tab A", exact: true }).click();
	assert.ok(Math.abs(Number(await size()) - resized) < 1);
	passed.push(
		"Tab B retains its own sizes and Tab A restores its resized layout",
	);
	await page.getByRole("button", { name: "Equalize" }).click();
	await page.waitForFunction(
		() =>
			Math.abs(
				Number(
					document.querySelector('[data-panel-group-id="a:root"] [data-panel]')
						.dataset.panelSize,
				) - 50,
			) < 1,
	);
	passed.push("Explicit equalize updates the mounted split");
	const png = Buffer.from(
		await page.evaluate(() => {
			const c = document.createElement("canvas");
			c.width = c.height = 450;
			const ctx = c.getContext("2d");
			const pixels = ctx.createImageData(450, 450);
			crypto.getRandomValues(pixels.data.subarray(0, 65536));
			for (let i = 65536; i < pixels.data.length; i++)
				pixels.data[i] = (i * 73 + (i % 93)) % 256;
			ctx.putImageData(pixels, 0, 0);
			return c.toDataURL("image/png").split(",")[1];
		}),
		"base64",
	);
	const payload = (name, size, type = "image/png") => ({
		name,
		mimeType: type,
		buffer: Buffer.concat([png, Buffer.alloc(Math.max(0, size - png.length))]),
	});
	const codex = page.locator("#codex input[type=file]");
	const claude = page.locator("#claude input[type=file]");
	await codex.setInputFiles(payload("screenshot.png", 600_000));
	await page.locator("#codex .session-image-tile").waitFor();
	await codex.setInputFiles(payload("clipboard", 800_000, "text/plain"));
	await page.waitForFunction(
		() => document.querySelectorAll("#codex .session-image-tile").length === 2,
	);
	await codex.setInputFiles(payload("five-megabytes.png", 5 * 1024 * 1024));
	await page.waitForFunction(
		() => document.querySelectorAll("#codex .session-image-tile").length === 3,
	);
	assert.equal(await page.locator("#codex-error").innerText(), "");
	passed.push(
		"Codex attaches 600 KB, mislabeled 800 KB, and exact 5 MB images",
	);
	await codex.setInputFiles(payload("too-large.png", 5 * 1024 * 1024 + 1));
	await page.getByText(/too-large.png: Attach up to 20 images/).waitFor();
	assert.equal(await page.locator("#codex .session-image-tile").count(), 3);
	passed.push(
		"Over 5 MB rejected with an image-specific error and draft preserved",
	);
	await claude.setInputFiles([
		payload("claude-large.png", 600_000),
		payload("claude-clipboard", 5 * 1024 * 1024, "application/octet-stream"),
	]);
	await page.waitForFunction(
		() => document.querySelectorAll("#claude .session-image-tile").length === 2,
	);
	passed.push(
		"Claude attaches and decodes large screenshots including extensionless 5 MB",
	);
	for (const provider of ["codex", "claude"]) {
		for (const eventType of ["paste", "drop"]) {
			console.log(`Checking ${provider} ${eventType}`);
			const before = await page
				.locator(`#${provider} .session-image-tile`)
				.count();
			const transfer = await page.evaluateHandle(
				({ base64, eventType }) => {
					const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
					const data = new DataTransfer();
					data.items.add(
						new File(
							[bytes, new Uint8Array(600_000)],
							`${eventType}-screenshot`,
							{ type: "application/octet-stream" },
						),
					);
					return data;
				},
				{ base64: png.toString("base64"), eventType },
			);
			await page
				.locator(`#${provider} textarea`)
				.first()
				.evaluate(
					(element, { eventType, transfer }) => {
						if (eventType === "drop") {
							for (const type of ["dragenter", "dragover"])
								element.dispatchEvent(
									new DragEvent(type, {
										dataTransfer: transfer,
										bubbles: true,
										cancelable: true,
									}),
								);
						}
						const event =
							eventType === "paste"
								? new ClipboardEvent("paste", {
										clipboardData: transfer,
										bubbles: true,
										cancelable: true,
									})
								: new DragEvent("drop", {
										dataTransfer: transfer,
										bubbles: true,
										cancelable: true,
									});
						element.dispatchEvent(event);
					},
					{ eventType, transfer },
				);
			await page
				.waitForFunction(
					({ provider, before }) =>
						document.querySelectorAll(`#${provider} .session-image-tile`)
							.length ===
						before + 1,
					{ provider, before },
				)
				.catch(async (error) => {
					console.error({
						provider,
						eventType,
						before,
						errors,
						codexError: await page.locator("#codex-error").innerText(),
					});
					throw error;
				});
			await transfer.dispose();
		}
	}
	passed.push(
		"Codex and Claude attach large extensionless images through paste and drag-and-drop",
	);
	await codex.setInputFiles(
		Array.from({ length: 18 }, (_, i) => payload(`extra-${i}.png`, 300_000)),
	);
	await page.waitForFunction(
		() => document.querySelectorAll("#codex .session-image-tile").length === 20,
	);
	await page.waitForTimeout(150);
	assert.equal(await page.locator("#codex .session-image-tile").count(), 20);
	passed.push(
		"20 images accepted; image 21 rejected without losing earlier attachments",
	);
	await page.screenshot({ path: `${out}/verified.png`, fullPage: true });
	assert.deepEqual(errors, []);
	passed.push("No browser errors");
	await writeFile(
		`${out}/ui-results.json`,
		JSON.stringify({ passed, errors }, null, 2),
	);
	console.log(JSON.stringify({ passed, errors }, null, 2));
} finally {
	await browser.close();
	server.close();
}
