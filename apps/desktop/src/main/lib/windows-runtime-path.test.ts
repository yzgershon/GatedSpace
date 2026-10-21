import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { augmentWindowsRuntimePath } from "./windows-runtime-path";

describe("public Windows runtime tools", () => {
	test("adds private Git and native agents even on an empty PATH, without overriding installed tools", () => {
		const env = { Path: "C:\\existing", PATH: "C:\\existing" };
		const options = {
			platform: "win32",
			resourcesPath: "C:/app/resources",
			home: "C:/user",
			exists: () => true,
		};
		augmentWindowsRuntimePath(env, options);
		expect(env.PATH.split(";")).toEqual([
			"C:\\existing",
			join("C:/user", ".local", "bin"),
			join("C:/app/resources", "resources", "git", "cmd"),
		]);
		expect(env.Path).toBe(env.PATH);
		augmentWindowsRuntimePath(env, options);
		expect(env.PATH.split(";")).toHaveLength(3);
	});
	test("does not add missing tools or modify other platforms", () => {
		const env = { PATH: "/usr/bin" };
		augmentWindowsRuntimePath(env, { platform: "linux", exists: () => true });
		expect(env).toEqual({ PATH: "/usr/bin" });
	});
});
