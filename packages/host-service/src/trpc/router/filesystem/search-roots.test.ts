import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { resolveTypedPath } from "./search-roots";

let root: string;
let projectDir: string;
let deepFile: string;

beforeEach(async () => {
	// Mirrors the real shape: an extra root (C:\Dev) holding sibling projects.
	root = await mkdtemp(join(tmpdir(), "search-roots-"));
	projectDir = join(root, "superset");
	await mkdir(projectDir, { recursive: true });
	deepFile = join(projectDir, "HANDOFF.md");
	await writeFile(deepFile, "handoff");
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

describe("resolveTypedPath", () => {
	it("ignores a query with no separator, so plain names still fuzzy-search", async () => {
		expect(await resolveTypedPath("HANDOFF.md", undefined, [root])).toBeNull();
		expect(await resolveTypedPath("handoff", undefined, [root])).toBeNull();
	});

	it("resolves a path relative to a configured root", async () => {
		const typed = ["superset", "HANDOFF.md"].join(sep);
		expect(await resolveTypedPath(typed, undefined, [root])).toEqual(deepFile);
	});

	/**
	 * The case this feature exists for. Typing `Dev\superset\HANDOFF.md` has to
	 * work when the configured root IS `C:\Dev` — joining onto the root itself
	 * would give `C:\Dev\Dev\superset\...`, so the root's PARENT is a base too.
	 */
	it("resolves a path that repeats the root's own folder name", async () => {
		const rootName = root.split(sep).filter(Boolean).pop() as string;
		const typed = [rootName, "superset", "HANDOFF.md"].join(sep);
		expect(await resolveTypedPath(typed, undefined, [root])).toEqual(deepFile);
	});

	it("accepts an absolute path inside a root", async () => {
		expect(await resolveTypedPath(deepFile, undefined, [root])).toEqual(
			deepFile,
		);
	});

	it("accepts forward slashes on any platform", async () => {
		expect(
			await resolveTypedPath("superset/HANDOFF.md", undefined, [root]),
		).toEqual(deepFile);
	});

	it("returns null for a path that does not exist", async () => {
		expect(
			await resolveTypedPath("superset/NOPE.md", undefined, [root]),
		).toBeNull();
	});

	it("returns null for a directory, since quick-open opens files", async () => {
		expect(await resolveTypedPath("superset", undefined, [root])).toBeNull();
	});

	/**
	 * Without this the palette becomes an arbitrary-file browser for anything
	 * the host process can read.
	 */
	it("refuses a path that escapes every configured root", async () => {
		const outside = await mkdtemp(join(tmpdir(), "outside-"));
		try {
			const secret = join(outside, "secret.txt");
			await writeFile(secret, "secret");
			expect(await resolveTypedPath(secret, undefined, [root])).toBeNull();
			expect(
				await resolveTypedPath(
					["..", "..", "etc", "passwd"].join(sep),
					undefined,
					[root],
				),
			).toBeNull();
		} finally {
			await rm(outside, { recursive: true, force: true });
		}
	});

	it("resolves against the workspace root when no extra roots are set", async () => {
		expect(await resolveTypedPath("superset/HANDOFF.md", root, [])).toEqual(
			deepFile,
		);
	});

	it("returns null when nothing is configured at all", async () => {
		expect(
			await resolveTypedPath("superset/HANDOFF.md", undefined, []),
		).toBeNull();
	});
});
