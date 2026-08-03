import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	clearBinaryResolutionCache,
	resolveBinaryFromPath,
} from "./resolve-binary";

const isWindows = process.platform === "win32";
const EXE = isWindows ? ".exe" : "";

let root: string;
let binDir: string;
let repoDir: string;

beforeEach(() => {
	clearBinaryResolutionCache();
	root = fs.mkdtempSync(path.join(os.tmpdir(), "resolve-bin-"));
	binDir = path.join(root, "tools");
	repoDir = path.join(root, "repo");
	fs.mkdirSync(binDir);
	fs.mkdirSync(repoDir);
});

afterEach(() => {
	clearBinaryResolutionCache();
	fs.rmSync(root, { recursive: true, force: true });
});

/**
 * Windows paths are case-insensitive, and the resolver builds its candidate
 * from PATHEXT (".EXE") rather than from the on-disk name ("gh.exe"), so the
 * casing of the returned string is not meaningful — only the target is.
 */
function samePath(a: string, b: string): boolean {
	return isWindows ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function envWithPath(dirs: string[]): NodeJS.ProcessEnv {
	return { PATH: dirs.join(path.delimiter), PATHEXT: ".COM;.EXE;.BAT;.CMD" };
}

describe("resolveBinaryFromPath", () => {
	test("resolves a bare name to an absolute path on PATH", () => {
		const real = path.join(binDir, `gh${EXE}`);
		fs.writeFileSync(real, "");
		expect(
			samePath(resolveBinaryFromPath("gh", envWithPath([binDir])), real),
		).toBe(true);
	});

	test("ignores an executable sitting in the working directory", () => {
		// The actual attack: a cloned repo with gh.exe at its root. libuv would
		// search cwd first, so resolution must never consider it.
		const planted = path.join(repoDir, `gh${EXE}`);
		fs.writeFileSync(planted, "");
		const real = path.join(binDir, `gh${EXE}`);
		fs.writeFileSync(real, "");

		const resolved = resolveBinaryFromPath("gh", envWithPath([binDir]));
		expect(samePath(resolved, real)).toBe(true);
		expect(samePath(resolved, planted)).toBe(false);
	});

	test("does not invent a path when only the repo copy exists", () => {
		// Nothing on PATH: returning the bare name preserves today's behaviour
		// (and today's error) rather than resolving to the planted file.
		const planted = path.join(repoDir, `gh${EXE}`);
		fs.writeFileSync(planted, "");
		expect(resolveBinaryFromPath("gh", envWithPath([binDir]))).toBe("gh");
	});

	test("takes the first PATH entry that matches", () => {
		const first = path.join(binDir, `git${EXE}`);
		const secondDir = path.join(root, "other");
		fs.mkdirSync(secondDir);
		fs.writeFileSync(first, "");
		fs.writeFileSync(path.join(secondDir, `git${EXE}`), "");
		expect(
			samePath(
				resolveBinaryFromPath("git", envWithPath([binDir, secondDir])),
				first,
			),
		).toBe(true);
	});

	test("leaves an already-explicit path alone", () => {
		const explicit = path.join(binDir, `gh${EXE}`);
		fs.writeFileSync(explicit, "");
		expect(resolveBinaryFromPath(explicit, envWithPath([binDir]))).toBe(
			explicit,
		);
		expect(resolveBinaryFromPath("./gh", envWithPath([binDir]))).toBe("./gh");
	});

	test("falls back to the bare name when nothing is found", () => {
		expect(
			resolveBinaryFromPath("definitely-not-here", envWithPath([binDir])),
		).toBe("definitely-not-here");
	});

	test("skips a directory that merely shares the name", () => {
		fs.mkdirSync(path.join(binDir, `gh${EXE}`));
		expect(resolveBinaryFromPath("gh", envWithPath([binDir]))).toBe("gh");
	});

	test("handles an empty or missing PATH without throwing", () => {
		expect(resolveBinaryFromPath("gh", { PATH: "" })).toBe("gh");
		expect(resolveBinaryFromPath("gh", {})).toBe("gh");
	});

	test("reads the Path spelling Windows may hand us", () => {
		const real = path.join(binDir, `gh${EXE}`);
		fs.writeFileSync(real, "");
		expect(
			samePath(
				resolveBinaryFromPath("gh", { Path: binDir, PATHEXT: ".EXE" }),
				real,
			),
		).toBe(true);
	});

	test("strips quotes around a PATH entry", () => {
		const real = path.join(binDir, `gh${EXE}`);
		fs.writeFileSync(real, "");
		expect(
			samePath(
				resolveBinaryFromPath("gh", { PATH: `"${binDir}"`, PATHEXT: ".EXE" }),
				real,
			),
		).toBe(true);
	});

	test.if(isWindows)("tries each PATHEXT extension", () => {
		const cmd = path.join(binDir, "gh.CMD");
		fs.writeFileSync(cmd, "");
		expect(
			samePath(
				resolveBinaryFromPath("gh", { PATH: binDir, PATHEXT: ".EXE;.CMD" }),
				cmd,
			),
		).toBe(true);
	});
});
