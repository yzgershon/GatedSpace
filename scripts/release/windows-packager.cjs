/** Personal-build entry point. Keep electron-builder's path safety checks intact. */
const { createRequire } = require("node:module");
const { join } = require("node:path");

function useNativeWindowsPaths(extra, platform = process.platform) {
	if (platform !== "win32" || typeof extra.realpath.native !== "function")
		return false;
	// fs-extra already wraps the native API for both Promise and callback callers.
	// Resolve every call afresh: junctions may change, so never cache their targets.
	const native = extra.realpath.native;
	extra.realpath = Object.assign((...args) => native(...args), { native });
	return true;
}

module.exports = { useNativeWindowsPaths };

if (require.main === module) {
	const appRequire = createRequire(join(process.cwd(), "package.json"));
	const builderRequire = createRequire(
		appRequire.resolve("electron-builder/package.json"),
	);
	try {
		const archiveRequire = createRequire(
			builderRequire.resolve("app-builder-lib/out/asar/asarUtil.js"),
		);
		if (useNativeWindowsPaths(archiveRequire("fs-extra")))
			console.log("Using native Windows path resolution for packaging.");
	} catch (error) {
		// An upstream module layout change should only forgo this optimization.
		if (error.code !== "MODULE_NOT_FOUND") throw error;
		console.log("Using electron-builder's default path resolution.");
	}
	const cli = appRequire.resolve("electron-builder/cli.js");
	process.argv = [process.execPath, cli, ...process.argv.slice(2)];
	require(cli);
}
