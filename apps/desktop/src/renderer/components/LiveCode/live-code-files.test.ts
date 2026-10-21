import { describe, expect, test } from "bun:test";
import type { CodexSessionState } from "shared/codex-session/types";
import {
	absoluteCodePath,
	claudeLiveFiles,
	codeReplacement,
	codexLiveFiles,
} from "./live-code-files";

describe("live code file events", () => {
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
