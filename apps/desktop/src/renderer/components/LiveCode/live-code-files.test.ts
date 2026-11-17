import { describe, expect, test } from "bun:test";
import type { CodexSessionState } from "shared/codex-session/types";
import {
	absoluteCodePath,
	claudeLiveFiles,
	codePathKey,
	codeReplacement,
	codexLiveFiles,
	snapshotPatch,
} from "./live-code-files";

describe("live code file events", () => {
	test("merges Windows absolute, relative, dot segments and aggregate diff paths", () => {
		const state = {
			cwd: "C:/Dev",
			status: "working",
			turnId: "turn",
			items: [
				{
					id: "1",
					turnId: "turn",
					changes: [
						{
							path: "C:\\Dev\\superset\\src\\app.ts",
							diff: "+first",
							kind: "update",
						},
					],
				},
				{
					id: "2",
					turnId: "turn",
					changes: [
						{ path: "superset/src/./APP.ts", diff: "+latest", kind: "update" },
					],
				},
			],
			turns: [
				{
					id: "turn",
					diff: "diff --git a/superset/src/app.ts b/superset/src/app.ts\n--- a/superset/src/app.ts\n+++ b/superset/src/app.ts\n@@ -1 +1 @@\n-before\n+after",
				},
			],
		} as CodexSessionState;
		const files = codexLiveFiles(state);
		expect(files).toHaveLength(1);
		expect(files[0].revision).toContain("2:");
		expect(files[0].patch).toContain("+after");
		expect(codePathKey("C:/Dev", "./superset/src/../src/app.ts")).toBe(
			"c:/dev/superset/src/app.ts",
		);
		expect(codePathKey("/work", "A.ts")).not.toBe(codePathKey("/work", "a.ts"));
	});
	test("snapshot diff includes removals and additions, not two identical views", () => {
		expect(snapshotPatch("one\nold\nthree", "one\nnew\nthree")).toContain(
			"-old\n+new",
		);
		expect(snapshotPatch("same", "same")).toBe("");
	});
	test("shows only the current Codex turn, excludes failed edits and follows the most recent file", () => {
		const state = {
			status: "working",
			turnId: "new",
			items: [
				{
					id: "old",
					turnId: "old",
					changes: [{ path: "old.ts", diff: "", kind: "update" }],
				},
				{
					id: "1",
					turnId: "new",
					changes: [{ path: "one.ts", diff: "+one", kind: "update" }],
				},
				{
					id: "2",
					turnId: "new",
					changes: [{ path: "two.ts", diff: "+two", kind: "update" }],
				},
				{
					id: "3",
					turnId: "new",
					changes: [{ path: "one.ts", diff: "+again", kind: "update" }],
				},
				{
					id: "4",
					turnId: "new",
					status: "failed",
					changes: [{ path: "failed.ts", diff: "", kind: "update" }],
				},
			],
		} as CodexSessionState;
		expect(codexLiveFiles(state).map((file) => file.path)).toEqual([
			"two.ts",
			"one.ts",
		]);
	});
	test("Claude Edit and Write events appear without querying Git", () => {
		expect(
			claudeLiveFiles([
				{
					kind: "tool",
					id: "1",
					toolUseId: "1",
					name: "Write",
					input: { file_path: "src/new.ts", content: "const a = 1;" },
					status: "success",
					parentToolUseId: null,
				},
				{
					kind: "tool",
					id: "2",
					toolUseId: "2",
					name: "Edit",
					input: { file_path: "src/old.ts", old_string: "a", new_string: "b" },
					status: "success",
					parentToolUseId: null,
				},
			]).map((file) => file.path),
		).toEqual(["src/new.ts", "src/old.ts"]);
	});
	test("a middle replacement preserves the unchanged suffix throughout display", () => {
		const old = "before\nold value\nafter",
			next = "before\nnew value\nafter";
		const edit = codeReplacement(old, next);
		expect(old.slice(0, edit.from) + edit.insert + edit.suffix).toBe(next);
		expect(
			old.slice(0, edit.from) + edit.insert.slice(0, 1) + edit.suffix,
		).toEndWith(" value\nafter");
		expect(codeReplacement(next, next).insert).toBe("");
	});
	test("keeps Windows absolute paths and resolves relative edit paths against session cwd", () => {
		expect(absoluteCodePath("C:\\Dev\\app", "src\\a.ts")).toBe(
			"C:/Dev/app/src/a.ts",
		);
		expect(absoluteCodePath("C:/Dev/app", "D:\\code\\a.ts")).toBe(
			"D:/code/a.ts",
		);
	});
});
