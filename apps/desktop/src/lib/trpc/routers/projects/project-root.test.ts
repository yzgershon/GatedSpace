import { describe, expect, test } from "bun:test";
import { checkProjectRoot } from "./project-root";

const WIN_ENV: NodeJS.ProcessEnv = {
	SystemRoot: "C:\\Windows",
	windir: "C:\\Windows",
	ProgramFiles: "C:\\Program Files",
	"ProgramFiles(x86)": "C:\\Program Files (x86)",
	ProgramData: "C:\\ProgramData",
	SUPERSET_HOME_DIR: "C:\\Users\\me\\.superset",
};

const isWindows = process.platform === "win32";

describe("checkProjectRoot", () => {
	test("refuses a whole volume", () => {
		// Confinement is relative to the root, so a root of C:\ confines
		// nothing.
		const root = isWindows ? "C:\\" : "/";
		expect(checkProjectRoot(root, WIN_ENV)).toBe("filesystem-root");
	});

	test("refuses an empty or blank path", () => {
		expect(checkProjectRoot("", WIN_ENV)).toBe("filesystem-root");
		expect(checkProjectRoot("   ", WIN_ENV)).toBe("filesystem-root");
	});

	test.if(isWindows)("refuses system directories and their children", () => {
		for (const path of [
			"C:\\Windows",
			"C:\\Windows\\System32",
			"C:\\Program Files",
			"C:\\Program Files (x86)\\Something",
			"C:\\ProgramData\\Thing",
		]) {
			expect(checkProjectRoot(path, WIN_ENV)).toBe("system-directory");
		}
	});

	test.if(isWindows)("refuses the app's own state directory", () => {
		// git-initialising it would put tokens and terminal logs under version
		// control.
		expect(checkProjectRoot("C:\\Users\\me\\.superset", WIN_ENV)).toBe(
			"system-directory",
		);
		expect(
			checkProjectRoot("C:\\Users\\me\\.superset\\worktrees", WIN_ENV),
		).toBe("system-directory");
	});

	test.if(isWindows)("is case-insensitive, as Windows paths are", () => {
		expect(checkProjectRoot("c:\\windows\\system32", WIN_ENV)).toBe(
			"system-directory",
		);
	});

	test.if(isWindows)("is not fooled by a prefix that is not a parent", () => {
		// "C:\WindowsProjects" starts with "C:\Windows" as a STRING but is not
		// inside it. Matching must be on path segments.
		expect(checkProjectRoot("C:\\WindowsProjects", WIN_ENV)).toBeNull();
		expect(checkProjectRoot("C:\\Program Files Backup", WIN_ENV)).toBeNull();
	});

	test.if(isWindows)("allows ordinary code directories", () => {
		for (const path of [
			"C:\\Dev\\superset",
			"C:\\Users\\me\\projects\\thing",
			"D:\\work\\repo",
		]) {
			expect(checkProjectRoot(path, WIN_ENV)).toBeNull();
		}
	});

	test.if(isWindows)("still allows the home directory itself", () => {
		// A dotfiles repo at ~ is a real pattern; refusing it would break a
		// legitimate workflow.
		expect(checkProjectRoot("C:\\Users\\me", WIN_ENV)).toBeNull();
	});

	test("tolerates a trailing separator", () => {
		const path = isWindows ? "C:\\Dev\\superset\\" : "/home/me/repo/";
		expect(checkProjectRoot(path, WIN_ENV)).toBeNull();
	});
});
