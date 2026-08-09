import { describe, expect, it } from "bun:test";
import {
	crossPlatformBinaryExcludes,
	nodeModulesResidueExcludes,
	nonRuntimeArtifactExcludes,
	packagedNodeModuleCopies,
	rendererBundledPackageExcludes,
} from "./runtime-dependencies";

// Mirrors the module's own resolution so this passes on an x64 runner too.
const PACKAGED_ARCH =
	(process.env.TARGET_ARCH ?? process.arch) === "x64" ? "x64" : "arm64";
const OTHER_ARCH = PACKAGED_ARCH === "x64" ? "arm64" : "x64";

/**
 * Approximates the glob matching electron-builder applies to `files` patterns.
 *
 * Deliberately behavioural rather than asserting on the pattern strings: the
 * point of these tests is which FILES survive packaging, and a test that pins
 * exact globs passes just as happily when the glob stops matching anything.
 */
function globToRegExp(glob: string): RegExp {
	let out = "";
	for (let i = 0; i < glob.length; i++) {
		const char = glob[i];
		if (char === "*") {
			if (glob[i + 1] === "*") {
				// `**/` spans any number of segments, including none.
				if (glob[i + 2] === "/") {
					out += "(?:.*/)?";
					i += 2;
				} else {
					out += ".*";
					i += 1;
				}
			} else {
				out += "[^/]*";
			}
			continue;
		}
		out += char.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
	}
	return new RegExp(`^${out}$`);
}

function isExcluded(patterns: string[], filePath: string): boolean {
	return patterns.some(
		(pattern) =>
			pattern.startsWith("!") && globToRegExp(pattern.slice(1)).test(filePath),
	);
}

describe("nonRuntimeArtifactExcludes", () => {
	it("drops source maps and MSVC scratch anywhere in the tree", () => {
		for (const file of [
			"dist/main/host-service.js.map",
			"dist/renderer/assets/index-B4OVYK9b.js.map",
			"node_modules/@linear/sdk/dist/index.d.mts.map",
			"node_modules/node-pty/prebuilds/win32-arm64/pty.pdb",
			"node_modules/node-pty/build/Release/obj/pty/pty.obj",
			"node_modules/node-pty/build/Release/pty.tlog",
		]) {
			expect(isExcluded(nonRuntimeArtifactExcludes, file)).toBe(true);
		}
	});

	/**
	 * Regression: on the 1.17.43 build the bare `!**\/*.map` stripped every map
	 * under node_modules but left all 633 in dist/ (107.8 MB), because the
	 * explicit `dist/**\/*` include in `files` outranks a later bare negation.
	 */
	it("strips maps from dist/, which needs its own scoped negation", () => {
		for (const file of [
			"dist/renderer/assets/index-B4OVYK9b.js.map",
			"dist/main/host-service.js.map",
			"dist/main/chunks/some-chunk.js.map",
		]) {
			expect(isExcluded(nonRuntimeArtifactExcludes, file)).toBe(true);
		}
		expect(nonRuntimeArtifactExcludes.some((p) => p === "!dist/**/*.map")).toBe(
			true,
		);
	});

	it("keeps everything that is actually loaded", () => {
		for (const file of [
			"dist/main/host-service.js",
			"node_modules/node-pty/build/Release/pty.node",
			"node_modules/node-pty/build/Release/winpty.dll",
			"node_modules/node-pty/build/Release/winpty-agent.exe",
			"node_modules/node-pty/prebuilds/win32-arm64/conpty.node",
			// Link-import stubs are deliberately kept — see the comment on the
			// exclude list.
			"node_modules/node-pty/build/Release/conpty.lib",
		]) {
			expect(isExcluded(nonRuntimeArtifactExcludes, file)).toBe(false);
		}
	});
});

describe("crossPlatformBinaryExcludes", () => {
	const arm64 = crossPlatformBinaryExcludes("arm64");
	const x64 = crossPlatformBinaryExcludes("x64");

	it("drops binaries for platforms this build cannot run", () => {
		for (const file of [
			"node_modules/onnxruntime-node/bin/napi-v3/darwin/arm64/libonnxruntime.1.21.0.dylib",
			"node_modules/onnxruntime-node/bin/napi-v3/linux/x64/libonnxruntime.so.1",
			"node_modules/koffi/build/koffi/linux_x64/koffi.node",
			"node_modules/koffi/build/koffi/freebsd_arm64/koffi.node",
			"node_modules/koffi/build/koffi/musl_x64/koffi.node",
		]) {
			expect(isExcluded(arm64, file)).toBe(true);
			expect(isExcluded(x64, file)).toBe(true);
		}
	});

	it("drops the other architecture and keeps its own", () => {
		const pairs: Array<[string, string]> = [
			[
				"node_modules/onnxruntime-node/bin/napi-v3/win32/arm64/onnxruntime.dll",
				"node_modules/onnxruntime-node/bin/napi-v3/win32/x64/onnxruntime.dll",
			],
			[
				"node_modules/koffi/build/koffi/win32_arm64/koffi.node",
				"node_modules/koffi/build/koffi/win32_x64/koffi.node",
			],
			[
				"node_modules/@libsql/win32-arm64-msvc/index.node",
				"node_modules/@libsql/win32-x64-msvc/index.node",
			],
			[
				"node_modules/@ast-grep/napi-win32-arm64-msvc/ast-grep-napi.win32-arm64-msvc.node",
				"node_modules/@ast-grep/napi-win32-x64-msvc/ast-grep-napi.win32-x64-msvc.node",
			],
		];
		for (const [armFile, x64File] of pairs) {
			expect(isExcluded(arm64, armFile)).toBe(false);
			expect(isExcluded(arm64, x64File)).toBe(true);
			expect(isExcluded(x64, x64File)).toBe(false);
			expect(isExcluded(x64, armFile)).toBe(true);
		}
	});

	/**
	 * Regression: node-pty is in packagedNodeModuleCopies AND auto-included from
	 * `dependencies`. The relative filter only governs the first path, so on
	 * 1.17.43 the auto-included copy put win32-x64 back. Both lists need it.
	 */
	it("prunes node-pty from the top-level list too, not just its copy filter", () => {
		for (const file of [
			"node_modules/node-pty/prebuilds/win32-x64/pty.node",
			"node_modules/node-pty/prebuilds/darwin-arm64/pty.node",
			"node_modules/node-pty/third_party/conpty/1.23.251008001/win10-x64/OpenConsole.exe",
		]) {
			expect(isExcluded(arm64, file)).toBe(true);
		}
		for (const file of [
			"node_modules/node-pty/prebuilds/win32-arm64/pty.node",
			"node_modules/node-pty/third_party/conpty/1.23.251008001/win10-arm64/OpenConsole.exe",
			"node_modules/node-pty/build/Release/pty.node",
		]) {
			expect(isExcluded(arm64, file)).toBe(false);
		}
	});

	it("prunes node-pty prebuilds via its own copy filter, not the top-level list", () => {
		// A `from`/`to` copy filters against paths INSIDE `from`, so these globs
		// are relative and the `**/node_modules/...` patterns above never apply.
		const copy = packagedNodeModuleCopies.find(
			(entry) => entry.from === "node_modules/node-pty",
		);
		expect(copy).toBeDefined();
		const filter = copy?.filter ?? [];

		expect(isExcluded(filter, "prebuilds/darwin-arm64/pty.node")).toBe(true);
		expect(isExcluded(filter, `prebuilds/win32-${OTHER_ARCH}/pty.node`)).toBe(
			true,
		);
		expect(
			isExcluded(filter, `prebuilds/win32-${PACKAGED_ARCH}/pty.node`),
		).toBe(false);
		expect(isExcluded(filter, "build/Release/pty.node")).toBe(false);
	});

	it("catches nested copies of the napi optional deps", () => {
		// mastracode carries its own @ast-grep, so a pattern anchored at the top
		// of node_modules would miss ~6 MB.
		expect(
			isExcluded(
				arm64,
				"node_modules/mastracode/node_modules/@ast-grep/napi-win32-x64-msvc/ast-grep-napi.win32-x64-msvc.node",
			),
		).toBe(true);
	});

	/**
	 * The one exception, and the reason this file has tests at all.
	 *
	 * agent-browser publishes no win32-arm64 binary — the x64 exe is the only
	 * Windows build there is, and ARM64 Windows runs it under emulation. Treating
	 * it like every other "wrong arch" binary leaves the browser with nothing to
	 * launch, on the architecture the maintainer actually ships.
	 */
	it("leaves mastracode's dynamically-loaded tools alone", () => {
		// mastracode reaches these through dynamic requires no grep can see:
		// @mastra/stagehand -> @browserbasehq/stagehand -> playwright/puppeteer,
		// @mastra/tavily -> @tavily/core -> js-tiktoken. Excluding them looks
		// safe and breaks the browser and web-search tools at the moment of use.
		for (const file of [
			"node_modules/js-tiktoken/dist/index.js",
			"node_modules/playwright-core/index.js",
			"node_modules/puppeteer-core/lib/cjs/puppeteer/puppeteer-core.js",
			"node_modules/patchright-core/index.js",
			"node_modules/@browserbasehq/stagehand/dist/index.js",
			"node_modules/@linear/sdk/dist/index-CFvuCe7a.mjs",
		]) {
			expect(isExcluded(arm64, file)).toBe(false);
			expect(isExcluded(rendererBundledPackageExcludes, file)).toBe(false);
		}
	});

	it("keeps agent-browser's x64 exe on ARM64, because there is no arm64 build", () => {
		const exe = "node_modules/agent-browser/bin/agent-browser-win32-x64.exe";
		expect(isExcluded(arm64, exe)).toBe(false);
		expect(isExcluded(x64, exe)).toBe(false);

		for (const file of [
			"node_modules/agent-browser/bin/agent-browser-darwin-arm64",
			"node_modules/agent-browser/bin/agent-browser-linux-x64",
		]) {
			expect(isExcluded(arm64, file)).toBe(true);
		}
	});
});

describe("rendererBundledPackageExcludes", () => {
	it("drops the node_modules copy of libraries Vite already compiled in", () => {
		for (const file of [
			"node_modules/react-icons/gi/index.js",
			"node_modules/mermaid/dist/mermaid.js",
			"node_modules/emojibase-data/en/data.json",
			"node_modules/posthog-js/dist/module.js",
			// mastracode nests its own copies
			"node_modules/mastracode/node_modules/react-icons/all.js",
		]) {
			expect(isExcluded(rendererBundledPackageExcludes, file)).toBe(true);
		}
	});

	it("does not touch dist, where the compiled copies actually live", () => {
		for (const file of [
			"dist/renderer/assets/mermaid-DUqWPkYq.js",
			"dist/renderer/assets/index-DaWmYMyD.js",
			"dist/renderer/assets/DevicePicker-DRpZBY8m.js",
		]) {
			expect(isExcluded(rendererBundledPackageExcludes, file)).toBe(false);
		}
	});
});

describe("nodeModulesResidueExcludes", () => {
	it("drops docs, tests and TypeScript sources from node_modules", () => {
		for (const file of [
			"node_modules/zod/README.md",
			"node_modules/express/lib/router/index.ts",
			"node_modules/hono/dist/types/index.d.ts",
			"node_modules/some-pkg/test/unit.js",
			"node_modules/some-pkg/__tests__/thing.js",
			"node_modules/some-pkg/examples/demo.js",
			"node_modules/some-pkg/.github/workflows/ci.yml",
		]) {
			expect(isExcluded(nodeModulesResidueExcludes, file)).toBe(true);
		}
	});

	/**
	 * Several licences in this tree require the text to ship with the binary,
	 * so these must survive even though they look like documentation.
	 */
	it("keeps LICENSE, NOTICE and CHANGELOG", () => {
		for (const file of [
			"node_modules/zod/LICENSE",
			"node_modules/express/NOTICE",
			"node_modules/hono/CHANGELOG",
		]) {
			expect(isExcluded(nodeModulesResidueExcludes, file)).toBe(false);
		}
	});

	it("never reaches outside node_modules", () => {
		for (const file of [
			"dist/main/index.js",
			"dist/renderer/assets/index-DaWmYMyD.js",
			"resources/build/icons/icon.ico",
			"package.json",
		]) {
			expect(isExcluded(nodeModulesResidueExcludes, file)).toBe(false);
		}
	});
});
