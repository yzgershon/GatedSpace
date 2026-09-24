import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import tailwind from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { build } from "vite";

const output = resolve(
	import.meta.dirname,
	"../../../.tmp/sync-settings-preview",
);
await mkdir(output, { recursive: true });
await build({
	configFile: false,
	envFile: false,
	logLevel: "warn",
	plugins: [react(), tailwind()],
	define: {
		"process.env": "{}",
		"process.platform": JSON.stringify(process.platform),
	},
	resolve: {
		alias: { renderer: resolve(import.meta.dirname, "../src/renderer") },
	},
	build: {
		outDir: output,
		emptyOutDir: false,
		minify: false,
		lib: {
			entry: resolve(import.meta.dirname, "sync-preview/renderer.tsx"),
			formats: ["iife"],
			name: "SyncPreview",
			fileName: () => "renderer.js",
			cssFileName: "style",
		},
	},
});
await writeFile(
	resolve(output, "index.html"),
	'<!doctype html><html class="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>GatedSpace · Sync settings preview</title><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/renderer.js"></script></body></html>',
);
createServer(async (req, res) => {
	const name =
		new URL(req.url ?? "/", "http://localhost").pathname.slice(1) ||
		"index.html";
	if (!["index.html", "renderer.js", "style.css"].includes(name)) {
		res.writeHead(404).end();
		return;
	}
	res.setHeader(
		"Content-Type",
		`${name.endsWith(".js") ? "text/javascript" : name.endsWith(".css") ? "text/css" : "text/html"}; charset=utf-8`,
	);
	res.end(await readFile(resolve(output, name)));
}).listen(52142, "127.0.0.1", () =>
	console.log("Sync UI fixture: http://127.0.0.1:52142"),
);
