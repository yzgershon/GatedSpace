import { afterEach, expect, test } from "bun:test";
import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
	packagedDistFilter,
	packagedSourceResourceFilter,
	verifyPackagedResourceLayout,
} from "./packaging-layout";
import {
	nodeModulesResidueExcludes,
	nonRuntimeArtifactExcludes,
	packagedNodeModuleCopies,
	rendererBundledPackageExcludes,
} from "./runtime-dependencies";

const appRequire = createRequire(import.meta.url);
const builderRequire = createRequire(
	appRequire.resolve("electron-builder/package.json"),
);
const libraryRequire = createRequire(
	builderRequire.resolve("app-builder-lib/package.json"),
);
// Exercise the installed packager's matcher, not a second implementation of globbing.
const { FileMatcher } = libraryRequire("./out/fileMatcher.js");
const asar = libraryRequire("@electron/asar");
const directories: string[] = [];
function temporary() {
	const directory = mkdtempSync(join(tmpdir(), "gatedspace-packaging-"));
	directories.push(directory);
	return directory;
}
afterEach(() => {
	for (const directory of directories.splice(0))
		rmSync(directory, { recursive: true, force: true });
});
function put(root: string, path: string) {
	const file = join(root, path);
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, "fixture");
	return file;
}
function checkFilter(patterns: string[], kept: string[], removed: string[]) {
	const directory = temporary();
	const matches = new FileMatcher(
		directory,
		directory,
		(value: string) => value,
		patterns,
	).createFilter();
	for (const [expected, files] of [
		[true, kept],
		[false, removed],
	] as const) {
		for (const name of files) {
			const file = put(directory, name);
			expect(matches(file, statSync(file)), name).toBe(expected);
		}
	}
}

test("dist FileSet keeps app code and browser assets but ships external resources only once", () => {
	checkFilter(
		packagedDistFilter,
		[
			"main/index.js",
			"preload/index.js",
			"renderer/index.html",
			"renderer/file-icons/ts.svg",
			"resources/browser-extension/manifest.json",
		],
		[
			"main/index.js.map",
			"renderer/assets/index.js.map",
			"resources/bin/superset.exe",
			"resources/git/cmd/git.exe",
			"resources/migrations/0001.sql",
			"resources/host-migrations/0001.sql",
			"resources/flow-dictation/GatedSpace.Flow.exe",
			"resources/mingit.zip",
		],
	);
});

test("source resources keep application icons and sounds while omitting build-only copies", () => {
	checkFilter(
		packagedSourceResourceFilter,
		[
			"build/icons/icon.png",
			"build/icons/icon.ico",
			"tray/icon.png",
			"sounds/done.wav",
		],
		["public/file-icons/ts.svg", "build/installer/background.tiff"],
	);
});

test("native runtime and loaders survive residue pruning through both packaging paths", () => {
	checkFilter(
		[
			"**/*",
			...nonRuntimeArtifactExcludes,
			...nodeModulesResidueExcludes,
			...rendererBundledPackageExcludes,
		],
		[
			"node_modules/better-sqlite3/build/Release/better_sqlite3.node",
			"node_modules/better-sqlite3/lib/index.js",
			"node_modules/better-sqlite3/LICENSE",
			"node_modules/fixture-library/runtime.mjs",
			"node_modules/fixture-library/runtime.cjs",
			"node_modules/fixture-library/source.mts",
			"node_modules/cytoscape-fcose/cytoscape-fcose.js",
		],
		[
			"node_modules/better-sqlite3/deps/sqlite3/sqlite3.c",
			"node_modules/@superset/host-service/.cache/tsbuildinfo.json",
			"node_modules/fixture-library/tsconfig.tsbuildinfo",
			"node_modules/fixture-library/index.d.mts",
			"node_modules/fixture-library/index.d.cts",
			"node_modules/cytoscape-fcose/demo/example.gif",
		],
	);
	const sqliteCopy = packagedNodeModuleCopies.find(
		(entry) => entry.from === "node_modules/better-sqlite3",
	);
	if (!sqliteCopy) throw new Error("Missing SQLite copy configuration");
	checkFilter(
		sqliteCopy.filter,
		["build/Release/better_sqlite3.node", "lib/index.js", "LICENSE"],
		["deps/sqlite3/sqlite3.c", "deps/sqlite3/sqlite3.h"],
	);
});

async function archiveFixture(extraFiles: string[] = []) {
	const directory = temporary();
	const source = join(directory, "source");
	const output = join(directory, "app");
	put(source, "dist/main/index.js");
	put(source, "dist/preload/index.js");
	put(source, "dist/renderer/index.html");
	for (const file of extraFiles) put(source, file);
	for (const file of [
		"bin/superset.exe",
		"git/cmd/git.exe",
		"migrations/0001.sql",
		"host-migrations/0001.sql",
		"flow-dictation/bundle.json",
	])
		put(output, `resources/resources/${file}`);
	await asar.createPackage(source, join(output, "resources/app.asar"));
	return output;
}

test("actual archive verification rejects duplicate tools and maps even if globs regress", async () => {
	for (const file of [
		"dist/resources/bin/superset.exe",
		"dist/resources/git/cmd/git.exe",
		"dist/resources/mingit.zip",
		"dist/main/index.js.map",
	]) {
		const output = await archiveFixture([file]);
		expect(() =>
			verifyPackagedResourceLayout(output, import.meta.dirname),
		).toThrow("Non-runtime or duplicate resource");
	}
});

test("actual archive verification requires the outside-asar CLI and migration files", async () => {
	const output = await archiveFixture();
	expect(() =>
		verifyPackagedResourceLayout(output, import.meta.dirname),
	).not.toThrow();
	writeFileSync(join(output, "resources/resources/bin/superset.exe"), "");
	expect(() =>
		verifyPackagedResourceLayout(output, import.meta.dirname),
	).toThrow("Bundled CLI missing");
});
