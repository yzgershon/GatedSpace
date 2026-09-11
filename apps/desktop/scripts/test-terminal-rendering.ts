/**
 * Real Electron/GPU regression for blank and clipped terminals under CSS zoom.
 * Run from apps/desktop: bun run scripts/test-terminal-rendering.ts
 * --baseline disables only the viewport fix and MUST fail at idle-0.85.
 * --atlas-baseline disables only atlas synchronization and MUST fail at shared-atlas-invalidation.
 * Output/screenshots: <repo>/.tmp/terminal-rendering/{fixed,baseline}/
 * Uses the actual runtime/addons; clipboard settings and keyboard IPC are stubbed.
 * No app data, daemon, accounts, version bump or installer is involved.
 */
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import electron from "electron";
import { build as buildFixture } from "vite";

const baseline = process.argv.includes("--baseline");
const atlasBaseline = process.argv.includes("--atlas-baseline");
const directory = resolve(import.meta.dir, "terminal-rendering");
const output = resolve(
	import.meta.dir,
	"../../../.tmp/terminal-rendering",
	baseline ? "baseline" : atlasBaseline ? "atlas-baseline" : "fixed",
);
await mkdir(output, { recursive: true });
await buildFixture({
	configFile: false,
	envFile: false,
	logLevel: "warn",
	resolve: {
		alias: {
			renderer: resolve(import.meta.dir, "../src/renderer"),
			shared: resolve(import.meta.dir, "../src/shared"),
		},
	},
	build: {
		outDir: output,
		emptyOutDir: false,
		minify: false,
		lib: {
			entry: resolve(directory, "renderer.ts"),
			name: "TerminalRenderingTest",
			formats: ["iife"],
			fileName: () => "renderer.js",
		},
	},
	define: {
		"process.env": "{}",
		"process.platform": JSON.stringify(process.platform),
	},
	plugins: [
		{
			name: "isolate-terminal-test-ipc",
			enforce: "pre",
			load(id) {
				if (/[/\\]renderer[/\\]lib[/\\]trpc-client\.ts$/.test(id))
					return "export const electronTrpcClient = {settings: {getTerminalCopyOnSelect: {query: async () => false}}, keyboardLayout: {changes: {subscribe: () => ({unsubscribe() {}})}}};";
				if (baseline && /[/\\]webgl-viewport\.ts$/.test(id))
					return "export const installWebglViewportSync = () => () => {};";
				if (atlasBaseline && /[/\\]webgl-atlas\.ts$/.test(id))
					return "export const installSharedWebglAtlasSync = () => () => {};";
			},
		},
	],
});
await writeFile(
	resolve(output, "xterm.css"),
	await readFile(
		resolve(import.meta.dir, "../node_modules/@xterm/xterm/css/xterm.css"),
	),
);
await writeFile(
	resolve(output, "main.cjs"),
	await readFile(resolve(directory, "main.cjs")),
);
await writeFile(
	resolve(output, "index.html"),
	`<!doctype html>
<html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:">
<link rel="stylesheet" href="xterm.css"><style>
html,body { margin:0; height:100%; background:#151110 }
.xterm,.xterm .xterm-scrollable-element,.xterm .xterm-viewport,.xterm .xterm-screen { width:100%;height:100% }
</style></head><body><script src="renderer.js"></script></body></html>`,
);

const env: NodeJS.ProcessEnv = {
	...process.env,
	GS_TERMINAL_TEST_OUTPUT: output,
};
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(String(electron), [resolve(output, "main.cjs")], {
	env,
	windowsHide: true,
	stdio: "inherit",
});
const code = await new Promise<number>((resolveExit, reject) => {
	child.on("error", reject);
	child.on("exit", (code) => resolveExit(code ?? 1));
});
console.log(`Terminal rendering report: ${resolve(output, "results.json")}`);
process.exit(code);
