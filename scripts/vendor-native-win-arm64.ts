#!/usr/bin/env bun
/**
 * Installs vendored win32-arm64 native binaries that upstream packages
 * do not publish to npm (see vendored/win32-arm64/README.md).
 *
 * - @anush008/tokenizers: napi loader checks for a local
 *   tokenizers.win32-arm64-msvc.node in the package dir before trying
 *   the (unpublished) platform package — we drop the file in.
 * - libsql: loader requires @libsql/win32-arm64-msvc — we materialize a
 *   stub platform package next to it in the store.
 *
 * No-op on every other platform/arch. Called from postinstall.ts.
 */
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

if (process.platform !== "win32" || process.arch !== "arm64") {
	process.exit(0);
}

const repoRoot = resolve(import.meta.dirname, "..");
const vendorDir = join(repoRoot, "vendored", "win32-arm64");
const bunStore = join(repoRoot, "node_modules", ".bun");

const glob = new Bun.Glob("@anush008+tokenizers@*/node_modules/@anush008/tokenizers");
for (const match of glob.scanSync({ cwd: bunStore, onlyFiles: false })) {
	const src = join(vendorDir, "tokenizers.win32-arm64-msvc.node");
	const dest = join(bunStore, match, "tokenizers.win32-arm64-msvc.node");
	if (existsSync(src) && !existsSync(dest)) {
		copyFileSync(src, dest);
		console.log(`[vendor-native] installed tokenizers.win32-arm64-msvc.node -> ${match}`);
	}
}

const libsqlGlob = new Bun.Glob("libsql@*/node_modules");
for (const match of libsqlGlob.scanSync({ cwd: bunStore, onlyFiles: false })) {
	const src = join(vendorDir, "libsql-win32-arm64-msvc.node");
	if (!existsSync(src)) continue;
	const pkgDir = join(bunStore, match, "@libsql", "win32-arm64-msvc");
	const dest = join(pkgDir, "index.node");
	if (!existsSync(dest)) {
		mkdirSync(pkgDir, { recursive: true });
		writeFileSync(
			join(pkgDir, "package.json"),
			JSON.stringify(
				{
					name: "@libsql/win32-arm64-msvc",
					version: "0.5.22",
					description: "Vendored local build (upstream publishes no win32-arm64 binary)",
					main: "index.node",
					files: ["index.node"],
				},
				null,
				2,
			),
		);
		copyFileSync(src, dest);
		console.log(`[vendor-native] materialized @libsql/win32-arm64-msvc -> ${match}`);
	}
}
