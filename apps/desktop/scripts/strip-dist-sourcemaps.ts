/**
 * Delete `dist/**\/*.map` before electron-builder packages the app.
 *
 * WHY THIS IS A SCRIPT AND NOT A GLOB
 *
 * `runtime-dependencies.ts` carries `!**\/*.map` and `!dist/**\/*.map` in the
 * electron-builder `files` array, and those work — for node_modules. They do
 * NOT take effect for `dist/`. Measured twice, on the 1.17.43 and 1.17.44
 * builds: 633 maps, 107.8 MB, sitting in the packaged asar under
 * `dist/renderer` and `dist/main` with zero maps anywhere else.
 *
 * Replicating app-builder-lib's own `minimatchAll` against the real pattern
 * list says those files should be excluded, so the divergence is somewhere in
 * its app-file walk that reading the source did not settle. Rather than ship a
 * config that claims to strip maps and silently doesn't, the files are removed
 * outright. A missing file cannot be re-included by matcher semantics.
 *
 * ORDERING MATTERS. This runs at the start of `build`, which is after
 * `prebuild`. That order is load-bearing:
 *
 *   - `validate-native-runtime.ts` READS `dist/main/index.js.map` to prove
 *     libsql and @parcel/watcher stayed external. It runs in `prebuild` and
 *     will hard-fail if the maps are already gone.
 *   - The Sentry vite plugin uploads maps during `compile:app`, also in
 *     `prebuild`, so uploads still happen and stack traces still symbolicate.
 *
 * Running `build` twice in a row is fine — deletion is idempotent, and
 * `prebuild` regenerates `dist/` from scratch.
 */

import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";

const DIST = join(import.meta.dirname, "..", "dist");

let removed = 0;
let bytes = 0;

async function strip(dir: string): Promise<void> {
	let entries: Awaited<ReturnType<typeof readdir>>;
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch {
		// dist/ absent — a `build` with no `prebuild`. Nothing to do.
		return;
	}
	for (const entry of entries) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			await strip(full);
		} else if (entry.name.endsWith(".map")) {
			bytes += (await stat(full)).size;
			await rm(full);
			removed++;
		}
	}
}

await strip(DIST);

if (removed === 0) {
	console.log("[strip-dist-sourcemaps] no .map files in dist/");
} else {
	console.log(
		`[strip-dist-sourcemaps] removed ${removed} source maps, ${(bytes / 1048576).toFixed(1)} MB`,
	);
}
