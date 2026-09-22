import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { build } from "vite";

const output = resolve(import.meta.dirname, "../../../.tmp/composer-preview");
await mkdir(output, { recursive: true });
await build({
	configFile: false,
	envFile: false,
	logLevel: "warn",
	plugins: [
		react(),
		tailwindcss(),
		{
			name: "preview-ipc",
			enforce: "pre",
			load(id) {
				if (/[/\\]renderer[/\\]lib[/\\]trpc-client\.ts$/.test(id))
					return readFile(
						resolve(import.meta.dirname, "codex-session/fixture-client.ts"),
						"utf8",
					);
			},
		},
	],
	resolve: {
		alias: {
			renderer: resolve(import.meta.dirname, "../src/renderer"),
			shared: resolve(import.meta.dirname, "../src/shared"),
		},
	},
	define: {
		"process.env": "{}",
		"process.platform": JSON.stringify(process.platform),
	},
	build: {
		outDir: output,
		emptyOutDir: false,
		minify: false,
		lib: {
			entry: resolve(import.meta.dirname, "composer-preview/renderer.tsx"),
			formats: ["iife"],
			name: "ComposerPreview",
			fileName: () => "renderer.js",
			cssFileName: "style",
		},
	},
});
await writeFile(
	resolve(output, "index.html"),
	'<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>GatedSpace · Composer options</title><link rel="stylesheet" href="/style.css"></head><body><script src="/renderer.js"></script></body></html>',
);
const server = createServer(async (request, response) => {
	const name =
		new URL(request.url ?? "/", "http://localhost").pathname.slice(1) ||
		"index.html";
	if (!["index.html", "renderer.js", "style.css"].includes(name)) {
		response.writeHead(404).end();
		return;
	}
	response.setHeader(
		"Content-Type",
		`${name.endsWith(".js") ? "text/javascript" : name.endsWith(".css") ? "text/css" : "text/html"}; charset=utf-8`,
	);
	response.end(await readFile(resolve(output, name)));
});
if (process.argv.includes("--build-only")) {
	console.log("Composer preview rebuilt.");
} else {
	server.listen(52124, "127.0.0.1", () =>
		console.log("Composer preview: http://127.0.0.1:52124"),
	);
}
