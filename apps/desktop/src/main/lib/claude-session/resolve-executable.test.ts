import { describe, expect, it } from "bun:test";
import { resolveExecutable } from "./resolve-executable";

const win = (files: string[]) => ({
	isWindows: true,
	pathDirs: ["C:\\bin", "C:\\npm"],
	exists: (candidate: string) => files.includes(candidate),
});

describe("resolveExecutable", () => {
	it("spawns a real .exe directly, with no shell", () => {
		const result = resolveExecutable("claude", win(["C:\\bin\\claude.exe"]));
		expect(result).toEqual({
			command: "C:\\bin\\claude.exe",
			needsShell: false,
		});
	});

	it("falls back to a shell only for a .cmd shim, which can't spawn directly", () => {
		const result = resolveExecutable("claude", win(["C:\\npm\\claude.cmd"]));
		expect(result).toEqual({
			command: "C:\\npm\\claude.cmd",
			needsShell: true,
		});
	});

	it("prefers the .exe when both forms sit in the same directory", () => {
		const result = resolveExecutable(
			"claude",
			win(["C:\\bin\\claude.cmd", "C:\\bin\\claude.exe"]),
		);
		expect(result.command).toBe("C:\\bin\\claude.exe");
		expect(result.needsShell).toBe(false);
	});

	it("respects PATH order across directories", () => {
		// C:\bin comes first, so its shim wins even though a later dir has an exe.
		const result = resolveExecutable(
			"claude",
			win(["C:\\bin\\claude.cmd", "C:\\npm\\claude.exe"]),
		);
		expect(result.command).toBe("C:\\bin\\claude.cmd");
	});

	it("honors an explicit path the user configured", () => {
		const result = resolveExecutable("D:\\tools\\claude.exe", {
			isWindows: true,
			pathDirs: [],
			exists: (c) => c === "D:\\tools\\claude.exe",
		});
		expect(result).toEqual({
			command: "D:\\tools\\claude.exe",
			needsShell: false,
		});
	});

	it("adds the extension for an explicit path given without one", () => {
		const result = resolveExecutable("D:\\tools\\claude", {
			isWindows: true,
			pathDirs: [],
			exists: (c) => c === "D:\\tools\\claude.exe",
		});
		expect(result.command).toBe("D:\\tools\\claude.exe");
	});

	it("hands an unresolvable name to the shell so it reports the real error", () => {
		const result = resolveExecutable("claude", win([]));
		expect(result).toEqual({ command: "claude", needsShell: true });
	});

	it("never needs a shell off Windows", () => {
		expect(
			resolveExecutable("claude", { isWindows: false, exists: () => false }),
		).toEqual({ command: "claude", needsShell: false });
	});
});
