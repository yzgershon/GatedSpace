import assert from "node:assert/strict";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { build } from "vite";

const directory = dirname(fileURLToPath(import.meta.url)),
	output = resolve(directory, "../../../../.tmp/live-code-production");
await mkdir(output, { recursive: true });
await mkdir(resolve(output, "file-icons"), { recursive: true });
for (const name of ["typescript", "react_ts", "css"])
	await copyFile(
		resolve(directory, `../../src/resources/public/file-icons/${name}.svg`),
		resolve(output, `file-icons/${name}.svg`),
	);
await build({
	configFile: false,
	envFile: false,
	logLevel: "warn",
	plugins: [
		react(),
		tailwindcss(),
		{
			name: "live-code-fixtures",
			enforce: "pre",
			load(id) {
				if (/renderer[/\\]lib[/\\]trpc-client\.ts$/.test(id))
					return `export const electronTrpcClient={filesystem:{readFile:{query:async(input)=>{window.live.reads++;if(!input.session||input.session.key!=='live-test')throw Error('Workspace not found: new-host-workspace');if(window.live.error)throw Error(window.live.error);const content=window.live.files[input.absolutePath]??window.live.content;return {kind:'text',content,byteLength:content.length}}},watchPath:{subscribe:(input,handlers)=>{if(!input.session)throw Error('Missing session scope');window.live.watches++;window.live.onWatchError=handlers.onError;window.live.listeners.add(handlers.onData);return {unsubscribe:()=>{window.live.watches--;window.live.listeners.delete(handlers.onData)}}}}}};`;
				if (
					id.endsWith("ClaudeSessionPane/sessionStore.ts") ||
					id.endsWith("ClaudeSessionPane\\sessionStore.ts")
				)
					return `export const getSessionCwd=()=>undefined,getSessionSnapshot=()=>undefined,subscribeSession=()=>()=>{};`;
			},
		},
	],
	resolve: {
		alias: {
			renderer: resolve(directory, "../../src/renderer"),
			shared: resolve(directory, "../../src/shared"),
			resources: resolve(directory, "../../src/resources"),
		},
	},
	define: { "process.env": JSON.stringify({}) },
	build: {
		outDir: output,
		emptyOutDir: false,
		lib: {
			entry: resolve(directory, "renderer.tsx"),
			name: "LiveCodeFixture",
			formats: ["iife"],
			fileName: () => "fixture.js",
			cssFileName: "fixture",
		},
	},
});
await writeFile(
	resolve(output, "index.html"),
	'<!doctype html><html><head><meta charset="utf-8"><title>Live code · GatedSpace</title><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="fixture.css"></head><body><script src="fixture.js"></script></body></html>',
);
const server = createServer(async (req, res) => {
	const name =
		new URL(req.url, "http://localhost").pathname.slice(1) || "index.html";
	if (
		![
			"index.html",
			"fixture.js",
			"fixture.css",
			"file-icons/typescript.svg",
			"file-icons/react_ts.svg",
			"file-icons/css.svg",
		].includes(name)
	)
		return void res.writeHead(404).end();
	res.setHeader(
		"Content-Type",
		name.endsWith(".js")
			? "text/javascript"
			: name.endsWith(".css")
				? "text/css"
				: name.endsWith(".svg")
					? "image/svg+xml"
					: "text/html",
	);
	res.end(await readFile(resolve(output, name)));
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const { chromium } = await import(
	process.env.PLAYWRIGHT_MODULE ?? "playwright"
);
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } }),
	errors = [],
	checks = [];
page.on("pageerror", (error) => errors.push(error.message));
const text = () =>
	page
		.locator(".gs-live-code-views>section")
		.last()
		.locator(".cm-line")
		.allTextContents();
try {
	await page.goto(`http://127.0.0.1:${server.address().port}/?test`);
	await page.getByLabel("Draft").fill("Preserve this draft");
	assert.equal(await page.evaluate(() => live.reads), 0);
	await page.getByLabel("Watch live code").click();
	await page.getByText("Ready for the next edit").waitFor();
	assert.equal(await page.evaluate(() => live.reads), 0);
	await page.evaluate(() =>
		live.edit("a.ts", 'export const label = "first live value";\n'),
	);
	await page.locator(".cm-line").first().waitFor();
	await page.waitForTimeout(900);
	assert.equal(
		(await text()).join("\n"),
		'export const label = "first live value";\n',
	);
	const initialReads = await page.evaluate(() => live.reads);
	await page.waitForTimeout(300);
	assert.equal(await page.evaluate(() => live.reads), initialReads);
	assert.equal(await page.evaluate(() => live.watches), 1);
	checks.push(
		"No filesystem reads before enabling; one selected-file watch and no idle polling",
	);
	await page.evaluate(() =>
		live.save(
			'export const label = "this is a much longer replacement that should stream";\n',
		),
	);
	await page.waitForTimeout(150);
	const partial = (await text()).join("\n");
	assert.ok(!partial.includes("should stream"));
	await page.waitForTimeout(900);
	assert.ok((await text()).join("\n").includes("should stream"));
	checks.push(
		"Real CodeMirror view streams a middle replacement and catches up to the file",
	);
	await page.getByRole("button", { name: "Diff", exact: true }).click();
	assert.equal(await page.locator(".cm-editor").count(), 2);
	assert.ok((await page.locator(".live-patch-insert").count()) > 0);
	await page.getByRole("button", { name: "Code", exact: true }).click();
	await page.getByLabel("Wrap lines").click();
	assert.ok((await page.locator(".cm-lineWrapping").count()) > 0);
	await page.evaluate(() => {
		live.error = "File temporarily unavailable";
	});
	await page.getByLabel("Refresh live file").click();
	await page
		.getByText("File temporarily unavailable", { exact: true })
		.waitFor();
	assert.ok((await text()).join("\n").includes("should stream"));
	await page.evaluate(() => {
		live.error = undefined;
	});
	await page.getByRole("button", { name: "Retry", exact: true }).click();
	await page
		.getByText("File temporarily unavailable", { exact: true })
		.waitFor({ state: "hidden" });
	await page.evaluate(() => live.onWatchError({ message: "Connection lost" }));
	await page
		.getByText("Live updates disconnected.", { exact: false })
		.waitFor();
	await page.getByRole("button", { name: "Retry", exact: true }).click();
	await page
		.getByText("Live updates disconnected.", { exact: false })
		.waitFor({ state: "hidden" });
	assert.equal(await page.evaluate(() => live.watches), 1);
	checks.push(
		"Read failures preserve code; watcher disconnects have an explicit retry and recover with one watch",
	);
	await page.evaluate(() =>
		live.edit("C:\\Dev\\superset\\a.ts", "export const final = true;\n"),
	);
	await page.waitForTimeout(900);
	assert.equal(await page.getByRole("tab").count(), 1);
	await page.evaluate(() => live.edit("b.ts", "export const second = true;\n"));
	await page.waitForTimeout(900);
	assert.equal(await page.getByRole("tab").count(), 2);
	await page.getByRole("tab", { name: "a.ts", exact: true }).click();
	await page.waitForTimeout(150);
	assert.ok((await text()).join("\n").includes("final"));
	await page.evaluate(() =>
		live.edit("b.ts", "export const second = false;\n"),
	);
	await page.waitForTimeout(150);
	assert.equal(
		await page
			.getByRole("tab", { name: "a.ts", exact: true })
			.getAttribute("aria-selected"),
		"true",
	);
	await page.getByRole("button", { name: "Follow agent", exact: true }).click();
	await page.waitForTimeout(900);
	assert.ok((await text()).join("\n").includes("second = false"));
	await page.getByRole("tab", { name: "b.ts", exact: true }).focus();
	await page.keyboard.press("ArrowLeft");
	assert.equal(
		await page
			.getByRole("tab", { name: "a.ts", exact: true })
			.getAttribute("aria-selected"),
		"true",
	);
	checks.push(
		"Windows path aliases share one tab; manual selection stays put; follow and keyboard switching work",
	);
	await page.getByLabel("Resize live conversation").focus();
	await page.keyboard.press("ArrowLeft");
	assert.equal(
		await page
			.getByLabel("Resize live conversation")
			.getAttribute("aria-valuenow"),
		"400",
	);
	const divider = await page
		.getByLabel("Resize live conversation")
		.boundingBox();
	await page.mouse.move(divider.x + divider.width / 2, divider.y + 100);
	await page.mouse.down();
	await page.mouse.move(divider.x - 36, divider.y + 100, { steps: 10 });
	await page.mouse.up();
	assert.ok(
		Number(
			await page
				.getByLabel("Resize live conversation")
				.getAttribute("aria-valuenow"),
		) >= 435,
	);
	assert.equal(await page.evaluate(() => live.mounts), 1);
	await page.screenshot({ path: resolve(output, "live-code-1200.png") });
	await page.getByLabel("Return to conversation").click();
	assert.equal(
		await page.getByLabel("Draft").inputValue(),
		"Preserve this draft",
	);
	assert.equal(await page.evaluate(() => live.mounts), 1);
	assert.equal(await page.evaluate(() => live.watches), 0);
	checks.push(
		"Return preserves the conversation mount and draft, restores layout, and stops the file watch",
	);
	await page.getByLabel("Watch live code").click();
	await page.locator(".cm-line").first().waitFor();
	for (const width of [900, 680, 620, 390]) {
		await page.setViewportSize({ width, height: 900 });
		await page.waitForTimeout(100);
		assert.ok(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= innerWidth,
			),
			`Overflow at ${width}`,
		);
		assert.ok(
			await page
				.getByLabel("Draft")
				.evaluate((el) => el.getBoundingClientRect().bottom <= innerHeight + 1),
			`Draft cropped at ${width}`,
		);
		await page.screenshot({ path: resolve(output, `live-code-${width}.png`) });
	}
	checks.push(
		"Responsive code/conversation layout and visible composer at 390/620/680/900/1200",
	);
	await page.emulateMedia({ reducedMotion: "reduce" });
	await page.evaluate(() => live.save("export const reduced = true;\n"));
	await page.waitForTimeout(200);
	assert.equal(await page.locator(".live-code-caret").count(), 0);
	assert.deepEqual(errors, []);
	checks.push("Reduced motion skips typing; no runtime errors");
	await page.emulateMedia({ reducedMotion: "no-preference" });
	await page.setViewportSize({ width: 1440, height: 920 });
	await page.goto(`http://127.0.0.1:${server.address().port}/`);
	await page
		.getByRole("tab", { name: "SessionList.tsx", exact: true })
		.waitFor();
	await page.locator(".cm-line").first().waitFor();
	await page.waitForTimeout(1000);
	assert.equal(await page.getByRole("tab").count(), 3);
	assert.ok(
		await page
			.locator(".gs-live-file-tabs img")
			.evaluateAll((nodes) =>
				nodes.every((image) => image.complete && image.naturalWidth > 0),
			),
	);
	await page.getByRole("button", { name: "Play edit" }).click();
	await page.waitForTimeout(1000);
	assert.ok((await text()).join("\n").includes("session.summary"));
	await page.screenshot({ path: resolve(output, "live-code-demo.png") });
	await page.getByRole("button", { name: "Diff", exact: true }).click();
	assert.ok((await page.locator(".live-patch-remove").count()) > 0);
	await page.screenshot({ path: resolve(output, "live-code-demo-diff.png") });
	assert.deepEqual(errors, []);
	checks.push(
		"Actual source preview renders file icons, syntax colors, replayed edits and a colored patch",
	);
	await writeFile(
		resolve(output, "results.json"),
		JSON.stringify({ checks, errors }, null, 2),
	);
	console.log(JSON.stringify({ checks, errors }));
} finally {
	await browser.close();
	server.close();
}
