/** Refresh assets without restarting the live delivery coordinator. */
import { join, resolve } from "node:path";

const build = await Bun.build({
	entrypoints: [join(import.meta.dir, "main.tsx")],
	outdir: resolve(import.meta.dir, "../../../../.tmp/ensemble-live/assets"),
	target: "browser",
	minify: true,
	loader: { ".svg": "file" },
	define: { "process.env.NODE_ENV": '"production"' },
});
if (!build.success) throw new Error(build.logs.map(String).join("\n"));
console.log("Flock preview assets refreshed; live sessions preserved.");
