import { expect, test } from "bun:test";
import { codexTaskChanges } from "./changes";
import type { CodexSessionState } from "./types";

const state = (): CodexSessionState => ({
	key: "pane",
	threadId: "thread",
	cwd: "C:/work",
	title: "",
	model: "",
	effort: "",
	status: "working",
	turnId: "active",
	approvals: [],
	error: null,
	historyCursor: null,
	diff: "",
	contextTokens: null,
	contextWindow: null,
	items: [
		{
			id: "old",
			turnId: "old",
			kind: "activity",
			title: "",
			text: "",
			changes: [{ path: "old.ts", kind: "update", diff: "+old" }],
		},
		{ id: "u", turnId: "active", kind: "user", title: "", text: "Change it" },
		{
			id: "edit",
			turnId: "active",
			kind: "activity",
			title: "",
			text: "",
			status: "completed",
			changes: [
				{
					path: "a.ts",
					kind: "update",
					diff: "@@ -1 +1,2 @@\n-old\n+new\n+extra",
				},
			],
		},
	],
});
test("live counts include only the current task and successful edits", () => {
	const s = state();
	expect(codexTaskChanges(s)).toEqual({ files: 1, added: 2, removed: 1 });
	s.items[2].status = "inProgress";
	expect(codexTaskChanges(s)).toBeNull();
	s.items[2].status = "failed";
	expect(codexTaskChanges(s)).toBeNull();
});
test("counts use the net turn patch and survive completion", () => {
	const s = state();
	s.status = "idle";
	s.turnId = null;
	s.turns = [
		{
			id: "active",
			status: "completed",
			diff: "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new",
		},
	];
	expect(codexTaskChanges(s)).toEqual({ files: 1, added: 1, removed: 1 });
});
test("a newly sent prompt hides the previous task's totals before the server responds", () => {
	const s = state();
	s.items.push({
		id: "local-user-new",
		turnId: "",
		kind: "user",
		title: "",
		text: "Next",
	});
	expect(codexTaskChanges(s)).toBeNull();
});
