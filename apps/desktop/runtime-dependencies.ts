type PackagedNodeModuleCopy = {
	filter: string[];
	from: string;
	to: string;
};

type ExternalizedRuntimeModule = {
	asarUnpackGlobs: string[];
	materialize: string[];
	packagedCopies: PackagedNodeModuleCopy[];
	specifier: string;
};

/**
 * Build and debug artifacts that are never read at runtime.
 *
 * These are measured, not guessed. On a 1.17.42 install: 436.8 MB of `.map`
 * across 19,046 files, plus 26 MB of `.pdb` sitting in `node-pty/prebuilds`
 * beside 2 MB of actual `.node` binaries, plus ~56 MB of MSVC scratch
 * (`.obj`/`.iobj`/`.tlog`) under `node-pty/build`.
 *
 * Source maps are still GENERATED, and must stay that way — this excludes them
 * at PACKAGING time only. Do not "simplify" this by setting `sourcemap: false`
 * in `electron.vite.config.ts`: `scripts/validate-native-runtime.ts:45` reads
 * `dist/main/index.js.map` to prove libsql and @parcel/watcher did not get
 * bundled, and hard-fails the build when it is missing. The Sentry plugin
 * uploads the same files, and dev mode reads them from `dist/` and never opens
 * the packaged asar. Nothing loads a `.map` from inside the installer.
 *
 * Keep `.lib`/`.exp` — link-import stubs, a few KB total, and not worth the
 * risk of a native module that resolves one at load.
 */
export const nonRuntimeArtifactExcludes = [
	"!**/*.map",
	"!**/*.pdb",
	"!**/*.obj",
	"!**/*.iobj",
	"!**/*.ipdb",
	"!**/*.tlog",
	/*
	 * `dist/**` needs its OWN negation, and this is not redundant.
	 *
	 * Measured on the 1.17.43 build: `!**\/*.map` alone stripped every map under
	 * node_modules but left all 633 in `dist/` — 107.8 MB — because the explicit
	 * `dist/**\/*` include in `files` outranks a later bare negation. Scoping the
	 * negation to the same root is what makes it win.
	 *
	 * If you ever see the installer jump ~20 MB, check this line first.
	 */
	"!dist/**/*.map",
];

/**
 * Same resolution as `electron-builder.ts` — one architecture per invocation,
 * set by TARGET_ARCH in CI and defaulting to the host arch for local builds.
 */
const packagedArch =
	(process.env.TARGET_ARCH ?? process.arch) === "x64" ? "x64" : "arm64";
const otherPackagedArch = packagedArch === "x64" ? "arm64" : "x64";

// `excludes` are relative to the module's own directory, because a from/to copy
// filters against paths inside `from`. The node_modules-prefixed globs used at
// the top level of `files` match nothing here.
function copyWholeModule(
	moduleName: string,
	excludes: string[] = [],
): PackagedNodeModuleCopy {
	return {
		from: `node_modules/${moduleName}`,
		to: `node_modules/${moduleName}`,
		filter: [
			"**/*",
			...nonRuntimeArtifactExcludes,
			...moduleResidueExcludes,
			...excludes,
		],
	};
}

/**
 * Native binaries for platforms and architectures this build cannot run.
 *
 * Several native deps ship every prebuild they have and let the loader pick at
 * runtime, so an ARM64 Windows install was carrying macOS, Linux, FreeBSD,
 * OpenBSD, musl and riscv64 binaries it can never execute. Measured on
 * 1.17.42: onnxruntime 140.6 MB of darwin+linux plus 33.2 MB of the wrong
 * Windows arch, koffi 73.4 MB across 17 foreign platforms, duckdb 36.2 MB,
 * node-pty 29.9 MB.
 *
 * Safe to do unconditionally because `electron-builder.ts` declares only a
 * `win:` target — there is no mac or linux build to starve. The arch half is
 * driven by TARGET_ARCH, which `build-desktop.yml` sets per matrix job, so
 * each invocation packages exactly one architecture.
 *
 * If a mac or linux target is ever added, this must become platform-aware
 * before it runs, or those builds ship with no loadable binding at all.
 */
export function crossPlatformBinaryExcludes(targetArch: string): string[] {
	const arch = targetArch === "x64" ? "x64" : "arm64";
	const otherArch = arch === "x64" ? "arm64" : "x64";
	const base = "**/node_modules";
	return [
		// onnxruntime resolves bin/napi-v3/<platform>/<arch> at require time.
		`!${base}/onnxruntime-node/bin/napi-v3/darwin/**`,
		`!${base}/onnxruntime-node/bin/napi-v3/linux/**`,
		`!${base}/onnxruntime-node/bin/napi-v3/win32/${otherArch}/**`,
		// koffi names its folders <platform>_<arch> and has 18 of them.
		`!${base}/koffi/build/koffi/darwin_*/**`,
		`!${base}/koffi/build/koffi/linux_*/**`,
		`!${base}/koffi/build/koffi/freebsd_*/**`,
		`!${base}/koffi/build/koffi/openbsd_*/**`,
		`!${base}/koffi/build/koffi/musl_*/**`,
		`!${base}/koffi/build/koffi/win32_ia32/**`,
		`!${base}/koffi/build/koffi/win32_${otherArch}/**`,
		// napi-style optional deps: <scope>/<name>-win32-<arch>-msvc. Globbed
		// under **/node_modules so nested copies are caught too — mastracode
		// carries its own @ast-grep.
		`!${base}/@libsql/win32-${otherArch}-msvc/**`,
		`!${base}/@ast-grep/napi-win32-${otherArch}-msvc/**`,
		// agent-browser ships NO win32-arm64 binary — the x64 exe is the only
		// Windows one there is, and ARM64 runs it under emulation. Dropping the
		// "wrong" arch here would leave the browser with nothing to launch, so
		// only the non-Windows binaries go.
		`!${base}/agent-browser/bin/agent-browser-darwin-*`,
		`!${base}/agent-browser/bin/agent-browser-linux-*`,
		/*
		 * node-pty needs its exclusions HERE as well as on its copyWholeModule
		 * filter. It is in packagedNodeModuleCopies AND auto-included from
		 * `dependencies`; the relative filter only governs the first path, so on
		 * 1.17.43 the auto-included copy put win32-x64 straight back.
		 *
		 * `third_party/conpty/<version>/win10-<arch>` is a second x64 payload that
		 * the `prebuilds/` glob never covered.
		 */
		`!${base}/node-pty/prebuilds/darwin-*/**`,
		`!${base}/node-pty/prebuilds/win32-${otherArch}/**`,
		`!${base}/node-pty/third_party/conpty/*/win10-${otherArch}/**`,
	];
}

/**
 * Libraries the renderer uses, shipped a second time as raw source.
 *
 * Vite compiles these into `dist/renderer` at build time, and the renderer is a
 * bundled web app — it cannot `require` out of `node_modules` at runtime. The
 * copies electron-builder adds because they appear in `dependencies` are
 * therefore unreachable. Verified present in the built output before listing:
 * mermaid has 77 chunks of its own, react-icons is inside `index-*.js`, and
 * emojibase's data is inlined into a chunk by `@tiptap/extension-emoji` (which
 * is why grepping the bundle for "emojibase" finds nothing — the package name
 * is compiled away, the data is not).
 *
 * Worth ~148 MB raw / ~29 MB of installer.
 *
 * The bar for adding to this list is that the package is unusable outside a
 * DOM. Do NOT extend it to things the main process might reach: static analysis
 * of the main bundle finds 17 external requires, but `mastracode` loads its
 * tools through dynamic requires that no grep will show.
 */
export const rendererBundledPackageExcludes = [
	"!**/node_modules/react-icons/**",
	"!**/node_modules/mermaid/**",
	"!**/node_modules/emojibase-data/**",
	"!**/node_modules/posthog-js/**",
];

/**
 * Documentation, tests and TypeScript sources that npm packages ship alongside
 * their compiled output. ~57 MB raw, ~11 MB of installer.
 *
 * `.ts` is safe to drop wholesale, `.d.ts` included: Node cannot load
 * TypeScript at runtime, and type declarations only matter to a compiler.
 *
 * LICENSE, NOTICE and CHANGELOG files are deliberately NOT here — some of the
 * licenses in this tree require the text to ship with the binary.
 */
const residuePatterns = [
	"*.md",
	"*.markdown",
	"*.ts",
	"*.flow",
	"test/**",
	"tests/**",
	"__tests__/**",
	"example/**",
	"examples/**",
	".github/**",
];

/** Anchored inside node_modules, for the top-level `files` array. */
export const nodeModulesResidueExcludes = residuePatterns.map(
	(pattern) => `!**/node_modules/**/${pattern}`,
);

/** Relative form, for a `from`/`to` copy that filters inside the module. */
const moduleResidueExcludes = residuePatterns.map(
	(pattern) => `!**/${pattern}`,
);

function copyModuleSubtree(
	moduleName: string,
	filter: string[],
): PackagedNodeModuleCopy {
	return {
		from: `node_modules/${moduleName}`,
		to: `node_modules/${moduleName}`,
		filter: [
			...filter,
			...nonRuntimeArtifactExcludes,
			...moduleResidueExcludes,
		],
	};
}

const externalizedRuntimeModules: ExternalizedRuntimeModule[] = [
	{
		specifier: "better-sqlite3",
		materialize: ["better-sqlite3"],
		packagedCopies: [copyWholeModule("better-sqlite3")],
		asarUnpackGlobs: ["**/node_modules/better-sqlite3/**/*"],
	},
	{
		specifier: "node-pty",
		materialize: ["node-pty"],
		packagedCopies: [
			copyWholeModule("node-pty", [
				// Only `prebuilds/win32-<arch>` and `build/Release` are ever loaded.
				// The rest is 29.9 MB of macOS and wrong-arch Windows binaries.
				// Mirrored into crossPlatformBinaryExcludes — see the note there.
				"!prebuilds/darwin-*/**",
				`!prebuilds/win32-${otherPackagedArch}/**`,
				`!third_party/conpty/*/win10-${otherPackagedArch}/**`,
			]),
		],
		asarUnpackGlobs: ["**/node_modules/node-pty/**/*"],
	},
	{
		specifier: "native-keymap",
		materialize: ["native-keymap"],
		packagedCopies: [copyWholeModule("native-keymap")],
		asarUnpackGlobs: ["**/node_modules/native-keymap/**/*"],
	},
	{
		specifier: "@superset/macos-process-metrics",
		materialize: ["@superset/macos-process-metrics"],
		packagedCopies: [copyWholeModule("@superset/macos-process-metrics")],
		asarUnpackGlobs: ["**/node_modules/@superset/macos-process-metrics/**/*"],
	},
	{
		specifier: "@ast-grep/napi",
		materialize: ["@ast-grep/napi"],
		packagedCopies: [
			copyWholeModule("@ast-grep", [
				`!napi-win32-${otherPackagedArch}-msvc/**`,
			]),
		],
		asarUnpackGlobs: ["**/node_modules/@ast-grep/napi*/**/*"],
	},
	{
		specifier: "@parcel/watcher",
		materialize: ["@parcel/watcher"],
		packagedCopies: [
			copyModuleSubtree("@parcel", ["watcher/**/*", "watcher-*/**/*"]),
		],
		asarUnpackGlobs: ["**/node_modules/@parcel/watcher*/**/*"],
	},
	{
		specifier: "libsql",
		materialize: ["libsql"],
		packagedCopies: [
			copyWholeModule("libsql"),
			copyWholeModule("@libsql", [`!win32-${otherPackagedArch}-msvc/**`]),
			copyWholeModule("@neon-rs"),
		],
		asarUnpackGlobs: ["**/node_modules/@libsql/**/*"],
	},
	{
		specifier: "@mastra/duckdb",
		materialize: [
			"@mastra/duckdb",
			"@duckdb/node-api",
			"@duckdb/node-bindings",
		],
		packagedCopies: [
			copyWholeModule("@mastra/duckdb"),
			// Ships a full 36-41 MB binding per arch; only one can ever load.
			copyWholeModule("@duckdb", [
				`!node-bindings-win32-${otherPackagedArch}/**`,
				"!node-bindings-darwin-*/**",
				"!node-bindings-linux-*/**",
			]),
		],
		asarUnpackGlobs: ["**/node_modules/@duckdb/**/*"],
	},
];

const packagedSupportModules = [
	copyWholeModule("bindings"),
	copyWholeModule("file-uri-to-path"),
	copyWholeModule("detect-libc"),
	copyWholeModule("is-glob"),
	copyWholeModule("is-extglob"),
	copyWholeModule("picomatch"),
	copyWholeModule("node-addon-api"),
];

export const mainExternalizedDependencies = [
	...externalizedRuntimeModules.map((module) => module.specifier),
	"pg-native",
	// mastracode transitively loads @mastra/fastembed → onnxruntime-node, whose
	// native binding is loaded via a dynamic `require` that @rollup/plugin-commonjs
	// can't resolve at bundle time. Externalizing lets Node handle the require at
	// runtime from node_modules. Also keeps the bundle size sane (~20 MB chunk).
	"mastracode",
];

export const packagedNodeModuleCopies = [
	...externalizedRuntimeModules.flatMap((module) => module.packagedCopies),
	...packagedSupportModules,
];

export const packagedAsarUnpackGlobs = [
	...externalizedRuntimeModules.flatMap((module) => module.asarUnpackGlobs),
	"**/node_modules/bindings/**/*",
	"**/node_modules/file-uri-to-path/**/*",
];

export const requiredMaterializedNodeModules = [
	...externalizedRuntimeModules.flatMap((module) => module.materialize),
	"bindings",
	"file-uri-to-path",
	"detect-libc",
	"is-glob",
	"is-extglob",
	"picomatch",
	"node-addon-api",
];
