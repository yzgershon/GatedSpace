import assert from "node:assert/strict";
import { existsSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

/** These are copied to resources/resources once, outside app.asar. */
export const externalResourceDirectories = [
	"bin",
	"git",
	"migrations",
	"host-migrations",
	"flow-dictation",
] as const;

// A from/to FileSet filters relative to dist. Top-level !dist/** globs did not
// reliably exclude these files in the public Windows app-file walk.
export const packagedDistFilter = [
	"**/*",
	"!**/*.map",
	...externalResourceDirectories.map((name) => `!resources/${name}/**/*`),
	"!resources/mingit.zip",
];

export const packagedSourceResourceFilter = [
	"**/*",
	// Vite has already copied public assets into dist/renderer.
	"!public/**/*",
	// Installer artwork is a build input, not an application resource.
	"!build/installer/**/*",
];

/** Inspect the actual archive: a config glob alone is not packaging evidence. */
export function verifyPackagedResourceLayout(
	appOutDir: string,
	projectDir: string,
) {
	const appRequire = createRequire(join(projectDir, "package.json"));
	const builderRequire = createRequire(
		appRequire.resolve("electron-builder/package.json"),
	);
	const libraryRequire = createRequire(
		builderRequire.resolve("app-builder-lib/package.json"),
	);
	const asar = libraryRequire("@electron/asar") as {
		listPackage(path: string): string[];
	};
	const entries = asar
		.listPackage(join(appOutDir, "resources/app.asar"))
		.map((name) => name.replaceAll("\\", "/").replace(/^\/+/, ""));
	const duplicated = entries.filter(
		(name) =>
			name === "dist/resources/mingit.zip" ||
			externalResourceDirectories.some((directory) =>
				name.startsWith(`dist/resources/${directory}/`),
			) ||
			(name.startsWith("dist/") && name.endsWith(".map")),
	);
	for (const file of [
		"dist/main/index.js",
		"dist/preload/index.js",
		"dist/renderer/index.html",
	]) {
		assert.ok(
			entries.includes(file),
			`Packaged application file missing: ${file}`,
		);
	}
	assert.equal(
		duplicated.length,
		0,
		`Non-runtime or duplicate resource in app.asar: ${duplicated[0]}`,
	);
	const resources = join(appOutDir, "resources/resources");
	assert.ok(
		statSync(join(resources, "bin/superset.exe")).size > 0,
		"Bundled CLI missing",
	);
	for (const directory of ["migrations", "host-migrations", "flow-dictation"]) {
		assert.ok(
			readdirSync(join(resources, directory)).length > 0,
			`Missing ${directory}`,
		);
	}
	if (existsSync(join(projectDir, "dist/resources/git/cmd/git.exe"))) {
		assert.ok(
			statSync(join(resources, "git/cmd/git.exe")).size > 0,
			"Bundled Git missing",
		);
	}
}
