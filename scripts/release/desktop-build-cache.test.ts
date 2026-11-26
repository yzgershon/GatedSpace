import { afterEach, expect, test } from "bun:test";
import {
	mkdirSync,
	mkdtempSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
	dependencyIdentity,
	desktopBuildCacheKeys,
} from "./desktop-build-cache";

const lock = {
	lockfileVersion: 1,
	workspaces: {
		"apps/desktop": {
			name: "@superset/desktop",
			version: "1.18.68",
			devDependencies: { electron: "40.8.5" },
		},
	},
	packages: { electron: ["electron@40.8.5", "", {}, "sha512-example"] },
};
test("release numbers reuse dependency downloads but dependency, integrity, and Bun changes do not", () => {
	const original = dependencyIdentity(JSON.stringify(lock), "1.3.14");
	const release = structuredClone(lock);
	release.workspaces["apps/desktop"].version = "1.18.69";
	expect(dependencyIdentity(JSON.stringify(release), "1.3.14")).toBe(original);
	release.workspaces["apps/desktop"].devDependencies.electron = "40.8.6";
	expect(dependencyIdentity(JSON.stringify(release), "1.3.14")).not.toBe(
		original,
	);
	const changedIntegrity = structuredClone(lock);
	changedIntegrity.packages.electron[3] = "sha512-changed";
	expect(
		dependencyIdentity(JSON.stringify(changedIntegrity), "1.3.14"),
	).not.toBe(original);
	expect(dependencyIdentity(JSON.stringify(lock), "1.3.15")).not.toBe(original);
	expect(() => dependencyIdentity("not json", "1.3.14")).toThrow();
	expect(() => dependencyIdentity("{}", "1.3.14")).toThrow();
});

const directories: string[] = [];
afterEach(() => {
	for (const directory of directories.splice(0))
		rmSync(directory, { recursive: true, force: true });
});
test("native and Flow cache keys track source names and bytes, ignoring generated output", async () => {
	const repo = mkdtempSync(join(tmpdir(), "gatedspace-cache-"));
	directories.push(repo);
	const put = (path: string, text = "source") => {
		const file = join(repo, path);
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, text);
	};
	put("bun.lock", JSON.stringify(lock));
	for (const path of [
		"scripts/release/prepare-native-deps.mjs",
		"scripts/vendor-native-win-arm64.ts",
		"packages/macos-process-metrics/package.json",
		"vendored/win32-arm64/index.node",
		"patches/native.patch",
		"apps/desktop/scripts/build-flow-dictation.ts",
		"apps/desktop/scripts/flow-bundle.ts",
		"apps/desktop/native/flow-dictation/Program.cs",
	])
		put(path);
	const original = await desktopBuildCacheKeys(repo);
	put("apps/desktop/native/flow-dictation/obj/generated.cs");
	expect(await desktopBuildCacheKeys(repo)).toEqual(original);
	put("patches/native.patch", "patched");
	const patched = await desktopBuildCacheKeys(repo);
	expect(patched.native).not.toBe(original.native);
	expect(patched.flow).toBe(original.flow);
	put("apps/desktop/native/flow-dictation/Program.cs", "updated");
	const updated = await desktopBuildCacheKeys(repo);
	expect(updated.flow).not.toBe(original.flow);
	expect(updated.native).toBe(patched.native);
	renameSync(
		join(repo, "apps/desktop/native/flow-dictation/Program.cs"),
		join(repo, "apps/desktop/native/flow-dictation/Startup.cs"),
	);
	expect((await desktopBuildCacheKeys(repo)).flow).not.toBe(updated.flow);
});
