import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { build } from "vite";

const desktop = resolve(import.meta.dir, "..");
const output = resolve(desktop, "../../.tmp/compact-workspaces-check");
mkdirSync(output, { recursive: true });
await build({
	configFile: false,
	envFile: false,
	logLevel: "warn",
	define: { "process.env.NODE_ENV": JSON.stringify("production") },
	plugins: [react(), tailwindcss()],
	resolve: {
		alias: {
			renderer: resolve(desktop, "src/renderer"),
			shared: resolve(desktop, "src/shared"),
		},
	},
	build: {
		outDir: output,
		emptyOutDir: false,
		lib: {
			entry: resolve(desktop, "scripts/compact-workspaces-check/renderer.tsx"),
			formats: ["iife"],
			name: "CompactWorkspacesCheck",
			fileName: () => "renderer.js",
			cssFileName: "style",
		},
	},
});
writeFileSync(
	resolve(output, "index.html"),
	'<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Compact workspace checks</title><link rel="stylesheet" href="/style.css"></head><body><script src="/renderer.js"></script></body></html>',
);
