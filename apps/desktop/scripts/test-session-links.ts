/** Production Markdown components; only native IPC and saved theme are fixtures. */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { build } from "vite";
import { resolvePlaywrightRuntime } from "../../../scripts/release/playwright-runtime.ts";

const root = resolve(import.meta.dirname, "../../..");
const output = resolve(root, ".tmp/session-links-audit");
await mkdir(output, { recursive: true });
await build({
	configFile: false,
	envFile: false,
	logLevel: "warn",
	plugins: [
		react(),
		tailwindcss(),
		{
			name: "link-fixture",
			enforce: "pre",
			load(id) {
				if (/renderer[/\\]lib[/\\]trpc-client\.ts$/.test(id))
					return `window.openedFiles=[]; export const electronTrpcClient={flowDictation:{start:{mutate:async()=>({recording:true})},stop:{mutate:async()=>{if(window.failDictation)throw new Error("Microphone unavailable");return {text:"Dictated words"}}},cancel:{mutate:async()=>({cancelled:true})}},external:{openLocalFile:{mutate:async(path)=>{if(window.failOpen)throw new Error('File not found');window.openedFiles.push(path)}}}};`;
				if (/renderer[/\\]stores[/\\]index\.ts$/.test(id))
					return 'export const useMarkdownStyle=()=>"default"; export const useTheme=()=>({type:"dark"});';
			},
		},
	],
	resolve: {
		alias: {
			renderer: resolve(import.meta.dirname, "../src/renderer"),
			shared: resolve(import.meta.dirname, "../src/shared"),
		},
	},
	define: { "process.env": "{}", "process.platform": '"win32"' },
	build: {
		outDir: output,
		emptyOutDir: false,
		minify: false,
		lib: {
			entry: resolve(import.meta.dirname, "session-links/renderer.tsx"),
			formats: ["iife"],
			name: "LinkFixture",
			fileName: () => "renderer.js",
			cssFileName: "style",
		},
	},
});
await writeFile(
	resolve(output, "index.html"),
	'<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="style.css"></head><body><script src="renderer.js"></script></body></html>',
);
const server = createServer(async (req, res) => {
	const name =
		new URL(req.url ?? "/", "http://localhost").pathname.slice(1) ||
		"index.html";
	if (!["index.html", "renderer.js", "style.css"].includes(name)) {
		res.writeHead(404).end();
		return;
	}
	res.setHeader(
		"Content-Type",
		name.endsWith(".js")
			? "text/javascript"
			: name.endsWith(".css")
				? "text/css"
				: "text/html",
	);
	res.end(await readFile(resolve(output, name)));
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const { chromium } = await import(resolvePlaywrightRuntime(root));
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
	const page = await browser.newPage({
		viewport: { width: 1000, height: 640 },
	});
	const errors: string[] = [];
	page.on("pageerror", (error: Error) => errors.push(error.message));
	const address = server.address() as { port: number };
	await page.goto(`http://127.0.0.1:${address.port}`);
	for (const provider of ["codex", "claude"]) {
		const panel = page.getByTestId(provider);
		const link = panel.getByRole("link", { name: "Open report" });
		await link.waitFor();
		assert.equal(
			await link.getAttribute("href"),
			"file:///C:/Dev/My%20report.md",
		);
		const style = await link.evaluate((el: Element) => ({
			color: getComputedStyle(el).color,
			decoration: getComputedStyle(el).textDecorationLine,
		}));
		assert.equal(style.color, "rgb(255, 121, 198)");
		assert.match(style.decoration, /underline/);
		await link.click();
		assert.equal(
			await panel.getByText("Blocked", { exact: true }).getAttribute("href"),
			null,
		);
	}
	assert.deepEqual(await page.evaluate("window.openedFiles"), [
		"C:/Dev/My report.md",
		"C:/Dev/My report.md",
	]);
	await page.evaluate("window.failOpen=true");
	await page
		.getByTestId("codex")
		.getByRole("link", { name: "Open report" })
		.click();
	await page.getByText("Could not open this file", { exact: true }).waitFor();
	await page.screenshot({ path: resolve(output, "links.png") });
	const draft = page.getByRole("textbox", { name: "Dictation draft" });
	await page.getByRole("button", { name: "Start Flow dictation" }).click();
	await page.getByRole("button", { name: "Finish Flow dictation" }).waitFor();
	await draft.fill("Typed during recording");
	await page.getByRole("button", { name: "Finish Flow dictation" }).click();
	await page.getByRole("button", { name: "Start Flow dictation" }).waitFor();
	assert.equal(
		await draft.inputValue(),
		"Typed during recording Dictated words",
	);
	await page.evaluate("window.failDictation=true");
	await page.getByRole("button", { name: "Start Flow dictation" }).click();
	await page.getByRole("button", { name: "Finish Flow dictation" }).click();
	await page
		.getByTestId("dictation")
		.getByText("Microphone unavailable")
		.waitFor();
	assert.equal(
		await draft.inputValue(),
		"Typed during recording Dictated words",
	);
	assert.deepEqual(errors, []);
	console.log(
		"PASS: Codex and Claude render pink underlined file links; clicking passes the decoded path to IPC; missing files surface errors; unsafe links remain blocked. OS opening is mocked.",
	);
	console.log(
		"PASS: production microphone control inserts fixture text, preserves concurrent typing and retains the draft on transcription failure.",
	);
} finally {
	await browser.close();
	server.close();
}
