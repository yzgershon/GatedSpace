import { describe, expect, test } from "bun:test";
import { buildTurnReview, splitTurnDiff } from "./review";
import type { CodexItem } from "./types";

const item = (
	id: string,
	path: string,
	diff: string,
	status = "completed",
): CodexItem => ({
	id,
	turnId: "turn",
	kind: "activity",
	title: "Edited files",
	text: "",
	status,
	changes: [{ path, diff, kind: "update" }],
});
const review = (items: CodexItem[], diff?: string) =>
	buildTurnReview({
		id: "thread:turn",
		turnId: "turn",
		cwd: "C:/work",
		items,
		diff,
	});

describe("task-scoped Codex changes", () => {
	test("restored item patches combine repeated files, retaining all recorded edits", () => {
		const value = review([
			item("a", "src\\a.ts", "@@ -1 +1 @@\n-old\n+new"),
			item("b", "src/a.ts", "@@ -2 +2,2 @@\n-older\n+newer\n+extra"),
			item("c", "b.ts", "@@ -1 +1 @@\n-old\n+new"),
		]);
		expect(value?.files).toHaveLength(2);
		expect(value?.files[0].diffs).toHaveLength(2);
		expect([value?.added, value?.removed]).toEqual([4, 3]);
	});
	test("a net turn diff takes priority over intermediate edits", () => {
		const value = review(
			[item("a", "intermediate.ts", "@@ -1 +1 @@\n-old\n+new")],
			"diff --git a/final.ts b/final.ts\n--- a/final.ts\n+++ b/final.ts\n@@ -1 +1,2 @@\n-old\n+new\n+extra\n",
		);
		expect(value?.files.map((f) => f.path)).toEqual(["final.ts"]);
		expect([value?.added, value?.removed]).toEqual([2, 1]);
	});
	test("adds, deletes, renames, binary files and quoted paths are retained", () => {
		const files = splitTurnDiff(
			[
				"diff --git a/new.ts b/new.ts\n--- /dev/null\n+++ b/new.ts\n@@ -0,0 +1 @@\n+new",
				"diff --git a/gone.ts b/gone.ts\n--- a/gone.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-old",
				"diff --git a/old.ts b/renamed.ts\nsimilarity index 100%\nrename from old.ts\nrename to renamed.ts",
				'diff --git "a/path with spaces.ts" "b/path with spaces.ts"\n--- "a/path with spaces.ts"\n+++ "b/path with spaces.ts"\n@@ -1 +1 @@\n-old\n+new',
				"diff --git a/image.png b/image.png\nBinary files a/image.png and b/image.png differ",
			].join("\n"),
		);
		expect(files.map((f) => [f.path, f.kind])).toEqual([
			["new.ts", "add"],
			["gone.ts", "delete"],
			["renamed.ts", "rename"],
			["path with spaces.ts", "update"],
			["image.png", "update"],
		]);
	});
	test("unsuccessful edits and tasks without edits do not fabricate a card", () => {
		expect(
			review([
				item("a", "no.ts", "+new", "failed"),
				item("b", "no.ts", "+new", "declined"),
				item("c", "no.ts", "+new", "inProgress"),
			]),
		).toBeNull();
		expect(review([])).toBeNull();
	});
	test("Windows patch lines and hunk content resembling headers are counted correctly", () => {
		const value = review(
			[],
			"diff --git a/gone.ts b/gone.ts\r\n--- a/gone.ts\r\n+++ /dev/null\r\n@@ -1 +0,0 @@\r\n---old\r\n",
		);
		expect(value?.files[0]).toMatchObject({
			path: "gone.ts",
			kind: "delete",
			removed: 1,
		});
		expect(
			splitTurnDiff(
				"diff --git a/old b/a/new\nrename from old\nrename to a/new",
			)[0].path,
		).toBe("a/new");
	});
	test("later task changes cannot mutate an earlier review snapshot", () => {
		const original = item("a", "original.ts", "@@ -1 +1 @@\n-old\n+new");
		const first = review([original]);
		if (!original.changes) throw Error("No fixture changes");
		original.changes[0].diff = "+subsequent edit";
		const second = review([item("b", "later.ts", "+later")]);
		expect(first?.files[0].diffs[0]).toContain("-old\n+new");
		expect(second?.files[0].path).toBe("later.ts");
	});
});
