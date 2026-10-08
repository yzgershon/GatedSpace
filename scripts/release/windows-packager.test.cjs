const assert = require("node:assert/strict");
const fs = require("node:fs");
const { createRequire } = require("node:module");
const { join, resolve } = require("node:path");
const { test } = require("node:test");
const { useNativeWindowsPaths } = require("./windows-packager.cjs");

test("non-Windows and unsupported runtimes retain the original resolver", () => {
	const original = () => {};
	const extra = { realpath: original };
	assert.equal(useNativeWindowsPaths(extra, "linux"), false);
	assert.equal(useNativeWindowsPaths(extra, "win32"), false);
	assert.equal(extra.realpath, original);
});

test(
	"native resolver preserves paths, failures, callbacks and live junction changes",
	{
		skip: process.platform !== "win32",
	},
	async () => {
		const appRequire = createRequire(resolve("apps/desktop/package.json"));
		const builderRequire = createRequire(
			appRequire.resolve("electron-builder/package.json"),
		);
		const archiveRequire = createRequire(
			builderRequire.resolve("app-builder-lib/out/asar/asarUtil.js"),
		);
		const original = archiveRequire("fs-extra").realpath;
		const extra = { realpath: original };
		assert.equal(useNativeWindowsPaths(extra), true);
		const tempRoot = resolve(".tmp");
		fs.mkdirSync(tempRoot, { recursive: true });
		const dir = fs.mkdtempSync(join(tempRoot, "native-path-test-"));
		try {
			const first = join(dir, "first folder");
			const second = join(dir, "second folder");
			const link = join(dir, "junction");
			fs.mkdirSync(first);
			fs.mkdirSync(second);
			fs.writeFileSync(join(first, "file.txt"), "first");
			fs.writeFileSync(join(second, "file.txt"), "second");
			fs.symlinkSync(first, link, "junction");
			const file = join(link, "file.txt");
			assert.equal(await extra.realpath(file), await original(file));
			assert.deepEqual(
				await extra.realpath(file, { encoding: "buffer" }),
				await original(file, { encoding: "buffer" }),
			);
			assert.equal(
				await new Promise((resolve, reject) =>
					extra.realpath(file, (error, value) =>
						error ? reject(error) : resolve(value),
					),
				),
				await original(file),
			);
			await assert.rejects(extra.realpath(join(link, "absent.txt")), {
				code: "ENOENT",
			});
			fs.unlinkSync(link);
			fs.symlinkSync(second, link, "junction");
			assert.equal(await extra.realpath(file), await original(file));
			assert.equal(await extra.realpath(file), join(second, "file.txt"));
			// The optimization must not make a junction into Windows safe to package.
			fs.unlinkSync(link);
			fs.symlinkSync(process.env.SystemRoot, link, "junction");
			const actualExtra = archiveRequire("fs-extra");
			try {
				useNativeWindowsPaths(actualExtra);
				const { AsarPackager } = builderRequire(
					"app-builder-lib/out/asar/asarUtil.js",
				);
				const guard = new AsarPackager(null, { resourcePath: dir });
				await assert.rejects(
					guard.protectSystemAndUnsafePaths(
						join(link, "System32", "kernel32.dll"),
						second,
					),
					/outside the package to a system or unsafe path/,
				);
			} finally {
				actualExtra.realpath = original;
				fs.unlinkSync(link);
			}
		} finally {
			assert.ok(resolve(dir).startsWith(`${tempRoot}\\native-path-test-`));
			fs.rmSync(dir, { recursive: true, force: true });
		}
	},
);
