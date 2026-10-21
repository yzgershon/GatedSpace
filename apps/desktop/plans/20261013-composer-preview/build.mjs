import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { build } from "vite";

const directory = dirname(fileURLToPath(import.meta.url));
await build({
	configFile: false,
	envFile: false,
	logLevel: "warn",
	define: { "process.env.NODE_ENV": JSON.stringify("production") },
	plugins: [react()],
	resolve: {
		alias: {
			renderer: resolve(directory, "../../src/renderer"),
			shared: resolve(directory, "../../src/shared"),
		},
	},
	build: {
		outDir: directory,
		emptyOutDir: false,
		lib: {
			entry: resolve(directory, "SettingsPreview.tsx"),
			formats: ["iife"],
			name: "ComposerSettingsPreview",
			fileName: () => "controls.js",
			cssFileName: "controls",
		},
	},
});
