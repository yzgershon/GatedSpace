/** Isolated, hidden Electron checks of the real panel/header components and GPU runtimes. */
import { spawn } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import electron from "electron";
import { build } from "vite";

const directory = resolve(import.meta.dir, "workspace-tools");
const preview = process.argv.includes("--preview");
const previewCheck = process.argv.includes("--preview-check");
const productionCss = process.argv.includes("--production-css");
if (preview && productionCss)
	throw new Error("Use --preview-check to verify production CSS offline");
const output = resolve(
	import.meta.dir,
	preview || previewCheck
		? `../../../.tmp/workspace-header-preview${productionCss ? "-production" : ""}`
		: "../../../.tmp/workspace-tools-test",
);
await mkdir(output, { recursive: true });
await build({
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
			entry: resolve(directory, "renderer.tsx"),
			name: "WorkspaceToolsTest",
			formats: ["iife"],
			fileName: () => "renderer.js",
			cssFileName: "style",
		},
	},
	define: {
		"process.env": "{}",
		"process.platform": JSON.stringify(process.platform),
	},
	plugins: [
		react(),
		tailwindcss(),
		{
			name: "isolated-workspace-services",
			enforce: "pre",
			load(id) {
				if (/[/\\]renderer[/\\]lib[/\\]trpc-client\.ts$/.test(id))
					return `const noop = { mutate: async () => {}, query: async () => false, subscribe: () => ({ unsubscribe() {} }) }; export const electronTrpcClient = { settings:{getTerminalCopyOnSelect:noop}, keyboardLayout:{changes:noop}, browser:{register:noop,unregister:noop}, browserHistory:{upsert:noop}, external:{openInApp:{mutate:async value=>{window.folderOpened=value}}} };`;
				if (/[/\\]ClaudeAccountSwap[/\\]index\.ts$/.test(id))
					return 'export const useClaudeAccounts = () => ({accounts:[{label:"Yish",configDir:"account-a"},{label:"Robbie",configDir:"account-b"}]});';
				if (/[/\\]ClaudeSessionPane[/\\]sessionStore\.ts$/.test(id))
					return 'export const subscribeSession=()=>()=>{}; export const getSessionCwd=id=>id==="session-a"?"C:\\\\Dev\\\\superset":"C:\\\\Dev\\\\SecondBrain"; export const getSessionSnapshot=id=>({accountConfigDir:id==="session-a"?"account-a":"account-b"});';
			},
		},
	],
});
await writeFile(
	resolve(output, "main.cjs"),
	await readFile(resolve(directory, previewCheck ? "preview.cjs" : "main.cjs")),
);
// The app loads its Tailwind base before lazy route CSS. This single-bundle
// fixture must declare the same layer order before dependency styles.
const stylesheet = await readFile(resolve(output, "style.css"), "utf8");
await writeFile(
	resolve(output, "style.css"),
	`@layer theme, base, components, utilities;\n${stylesheet}`,
);
let styles = '<link rel="stylesheet" href="style.css">';
if (productionCss) {
	const renderer = resolve(import.meta.dir, "../dist/renderer");
	const html = await readFile(resolve(renderer, "index.html"), "utf8");
	const entry = html.match(/href="\.\/assets\/([^"<>]+\.css)"/)?.[1];
	if (!entry)
		throw new Error(
			"Compile the desktop renderer before checking production CSS",
		);
	const files = await readdir(resolve(renderer, "assets"));
	styles = [
		entry,
		...files.filter((file) => file.endsWith(".css") && file !== entry),
	]
		.map(
			(file) =>
				`<link rel="stylesheet" href="${pathToFileURL(resolve(renderer, "assets", file)).href}">`,
		)
		.join("\n");
	await writeFile(
		resolve(output, "fixture.css"),
		await readFile(resolve(directory, "test.css")),
	);
	styles += '<link rel="stylesheet" href="fixture.css">';
}
await writeFile(
	resolve(output, "index.html"),
	`<!doctype html><html><head><meta charset="utf-8">${styles}</head><body><div id="app"></div><script src="renderer.js"></script></body></html>`,
);
if (preview) {
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch(request) {
			const pathname = new URL(request.url).pathname;
			const file = pathname === "/" ? "index.html" : pathname.slice(1);
			if (!["index.html", "renderer.js", "style.css"].includes(file))
				return new Response("Not found", { status: 404 });
			return new Response(Bun.file(resolve(output, file)));
		},
	});
	console.log(`Header preview: http://127.0.0.1:${server.port}/?preview`);
	await new Promise(() => {});
}
const env = { ...process.env, GS_TOOLS_TEST_OUTPUT: output };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(String(electron), [resolve(output, "main.cjs")], {
	env,
	windowsHide: true,
	stdio: "inherit",
});
const exit = await new Promise<number>((resolveExit, reject) => {
	child.on("error", reject);
	child.on("exit", (code) => resolveExit(code ?? 1));
});
console.log(`Workspace tool panel report: ${resolve(output, "results.json")}`);
process.exit(exit);
