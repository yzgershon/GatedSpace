import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { build } from "vite";
import { controlsPreviewIpcMock } from "./controls-preview/mock-plugin.mjs";

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(desktop, "../../.tmp/floating-tabs-preview");
await mkdir(output, { recursive: true });
await build({
	configFile: false,
	envFile: false,
	logLevel: "warn",
	define: { "process.env.NODE_ENV": JSON.stringify("production") },
	plugins: [controlsPreviewIpcMock(desktop), react(), tailwindcss()],
	resolve: {
		alias: [
			...[
				"renderer/lib/trpc-client",
				"renderer/routes/_authenticated/_dashboard/v2-workspace/providers/WorkspaceProvider",
				"renderer/hooks/host-service/useV2NotificationStatus",
				"renderer/stores/v2-notifications",
				"renderer/components/StatusIndicator",
			].map((find) => ({
				find,
				replacement: resolve(desktop, "scripts/controls-preview/mock.ts"),
			})),
			{ find: "renderer", replacement: resolve(desktop, "src/renderer") },
			{ find: "shared", replacement: resolve(desktop, "src/shared") },
		],
	},
	build: {
		outDir: output,
		emptyOutDir: false,
		lib: {
			entry: resolve(desktop, "scripts/floating-tabs-preview/renderer.tsx"),
			formats: ["iife"],
			name: "FloatingTabsPreview",
			fileName: () => "renderer.js",
			cssFileName: "style",
		},
	},
});
await writeFile(
	resolve(output, "index.html"),
	'<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>@layer theme, base, components, utilities;</style><title>GatedSpace - Floating tabs</title><link rel="stylesheet" href="/style.css"></head><body><script src="/renderer.js"></script></body></html>',
);
if (process.argv.includes("--build-only")) process.exit(0);
const server = createServer(async (req, res) => {
	const name =
		new URL(req.url, "http://localhost").pathname.slice(1) || "index.html";
	if (!["index.html", "renderer.js", "style.css"].includes(name))
		return void res.writeHead(404).end();
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
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const url = `http://127.0.0.1:${server.address().port}`;
await writeFile(
	resolve(
		output,
		process.argv.includes("--serve") ? "url.txt" : "check-url.txt",
	),
	url,
);
console.log(url);
