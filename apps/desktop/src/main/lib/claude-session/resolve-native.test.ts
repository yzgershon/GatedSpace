import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { resolveNativeClaude } from "./resolve-native";

describe("native Claude launch", () => {
	test.each([
		"claude-acct",
		"claude-acct.cmd",
		"C:/Users/test/.superset/bin/claude-acct.cmd",
	])("resolves the saved account launcher %s without its shell banner", (binary) => {
		const native = join("C:/Users/test", ".local", "bin", "claude.exe");
		expect(
			resolveNativeClaude(binary, {
				isWindows: true,
				home: "C:/Users/test",
				pathDirs: ["C:/Users/test/.superset/bin"],
				exists: (p) => p === native || p.endsWith("claude-acct.cmd"),
			}),
		).toEqual({ command: native, args: [], env: {} });
	});
	test("does not bypass a different custom account script", () => {
		expect(() =>
			resolveNativeClaude("C:/custom/claude-acct.cmd", {
				isWindows: true,
				home: "C:/Users/test",
				exists: (p) => p === "C:/custom/claude-acct.cmd",
			}),
		).toThrow("shell wrapper");
	});
	test("bypasses the managed cmd/bash wrapper even when it leads PATH", () => {
		const home = "C:/Users/test";
		const native = join(home, ".local", "bin", "claude.exe");
		const found = resolveNativeClaude("claude", {
			isWindows: true,
			home,
			pathDirs: ["C:/Users/test/.superset/bin", "C:/npm"],
			exists: (p) => p === native || /claude\.cmd$/.test(p),
		});
		expect(found.command).toBe(native);
		expect(found.args).toEqual([]);
	});
	test("runs npm's JS entry with Node argv instead of shell-interpreting JSON", () => {
		const dir = "C:/npm";
		const shim = join(dir, "claude.cmd");
		const entry = join(
			dir,
			"node_modules",
			"@anthropic-ai",
			"claude-code",
			"cli.js",
		);
		const found = resolveNativeClaude("claude", {
			isWindows: true,
			pathDirs: [dir],
			home: "C:/empty",
			execPath: "electron.exe",
			exists: (p) => p === shim || p === entry,
		});
		expect(found).toEqual({
			command: "electron.exe",
			args: [entry],
			env: { ELECTRON_RUN_AS_NODE: "1" },
		});
	});
	test("does not concatenate an arbitrary custom batch file into a shell command", () => {
		expect(() =>
			resolveNativeClaude("C:/custom/agent.cmd", {
				isWindows: true,
				exists: (p) => p === "C:/custom/agent.cmd",
			}),
		).toThrow("shell wrapper");
	});
});
