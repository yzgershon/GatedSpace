import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { build } from "vite";

const scripts = dirname(fileURLToPath(import.meta.url));
const output = resolve(scripts, "../../../.tmp/sidebar-preview");
await mkdir(output, { recursive: true });
await build({
	configFile: false,
	envFile: false,
	logLevel: "warn",
	plugins: [react()],
	define: { "process.env.NODE_ENV": JSON.stringify("production") },
	build: {
		outDir: output,
		emptyOutDir: false,
		lib: {
			entry: resolve(scripts, "sidebar-preview/renderer.tsx"),
			formats: ["iife"],
			name: "SidebarPreview",
			fileName: () => "renderer.js",
			cssFileName: "style",
		},
	},
});
await writeFile(
	resolve(output, "index.html"),
	'<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>GatedSpace · Sidebar directions</title><link rel="stylesheet" href="/style.css"></head><body><script src="/renderer.js"></script></body></html>',
);
if (!process.argv.includes("--build-only")) {
	const server = createServer(async (req, res) => {
		const name =
			new URL(req.url ?? "/", "http://localhost").pathname.slice(1) ||
			"index.html";
		if (!["index.html", "renderer.js", "style.css"].includes(name))
			return void res.writeHead(404).end();
		res.setHeader("Cache-Control", "no-store");
		res.setHeader(
			"Content-Type",
			`${name.endsWith(".js") ? "text/javascript" : name.endsWith(".css") ? "text/css" : "text/html"}; charset=utf-8`,
		);
		res.end(await readFile(resolve(output, name)));
	});
	server.listen(52135, "127.0.0.1", () =>
		console.log("Preview: http://127.0.0.1:52135"),
	);
}
