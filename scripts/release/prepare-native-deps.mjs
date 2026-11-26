import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Use the same pinned rebuilder as electron-builder, with its content/ABI cache.
// This still rebuilds on a miss. Package validation and startup tests stay required.
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const desktop = join(repo, "apps/desktop");
const pkg = JSON.parse(readFileSync(join(desktop, "package.json"), "utf8"));
const electronVersion = pkg.devDependencies.electron.replace(/^\^/, "");
if (!/^\d+\.\d+\.\d+$/.test(electronVersion))
	throw new Error(
		"Pin an exact Electron version before rebuilding native modules",
	);
const arch = process.env.TARGET_ARCH ?? process.arch;
if (arch !== process.arch)
	throw new Error(
		"Prepare native dependencies on a runner matching the target architecture",
	);
const appRequire = createRequire(join(desktop, "package.json"));
const builderRequire = createRequire(
	appRequire.resolve("electron-builder/package.json"),
);
const libraryRequire = createRequire(
	builderRequire.resolve("app-builder-lib/package.json"),
);
const { rebuild } = await import(
	pathToFileURL(libraryRequire.resolve("@electron/rebuild")).href
);
const started = performance.now();
const pending = rebuild({
	buildPath: desktop,
	projectRootPath: repo,
	electronVersion,
	arch,
	platform: process.platform,
	buildFromSource: false,
	// Match electron-builder: do not replace shipped prebuilds during a rebuild.
	disablePreGypCopy: true,
	mode: "sequential",
	useCache: true,
	cachePath:
		process.env.GATEDSPACE_NATIVE_CACHE ??
		join(homedir(), ".electron-rebuild-cache"),
});
pending.lifecycle.on("module-found", (name) =>
	console.log(`[native] Checking ${name} (${arch})`),
);
pending.lifecycle.on("module-done", (name) =>
	console.log(`[native] Ready ${name}`),
);
await pending;
console.log(
	`[native] Electron ${electronVersion}/${arch} ready in ${((performance.now() - started) / 1000).toFixed(1)}s`,
);
