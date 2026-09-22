import { expect, test } from "bun:test";
import type { CodexItem, CodexSessionState } from "shared/codex-session/types";
import {
	activeWorkLabel,
	diffStats,
	groupActivities,
	groupLabel,
	type TranscriptTurn,
	transcriptTurns,
} from "./activity";

test("live heading describes current observable work and ignores completed tools", () => {
	const turn: TranscriptTurn = {
		id: "t",
		users: [],
		work: [],
		answers: [],
		active: true,
	};
	expect(activeWorkLabel(turn)).toBe("Thinking");
	turn.work.push({
		id: "cmd",
		turnId: "t",
		kind: "activity",
		activityType: "commandExecution",
		status: "inProgress",
		title: "",
		text: "",
	});
	expect(activeWorkLabel(turn)).toBe("Running commands");
	turn.work[0].status = "completed";
	expect(activeWorkLabel(turn)).toBe("Thinking");
	turn.answers.push({
		id: "answer",
		turnId: "t",
		kind: "assistant",
		title: "",
		text: "Result",
		status: "inProgress",
	});
	expect(activeWorkLabel(turn)).toBe("Writing response");
	turn.work.push({
		id: "browser",
		turnId: "t",
		kind: "activity",
		activityType: "browser",
		status: "inProgress",
		title: "",
		text: "",
	});
	expect(activeWorkLabel(turn)).toBe("Using the browser");
});

test("Desktop groups preserve commentary order and leave final answers outside collapsed work", () => {
	const items: CodexItem[] = [
		{ id: "u", turnId: "t", kind: "user", text: "Fix", title: "" },
		{
			id: "a",
			turnId: "t",
			kind: "assistant",
			phase: "commentary",
			text: "Checking",
			title: "",
		},
		{
			id: "c",
			turnId: "t",
			kind: "activity",
			activityType: "commandExecution",
			text: "ok",
			title: "Run",
		},
		{
			id: "r",
			turnId: "t",
			kind: "activity",
			activityType: "reasoning",
			text: "",
			title: "Summary",
		},
		{
			id: "f",
			turnId: "t",
			kind: "activity",
			activityType: "fileChange",
			text: "diff",
			title: "Edited",
		},
		{
			id: "end",
			turnId: "t",
			kind: "assistant",
			phase: "final_answer",
			text: "Done",
			title: "",
		},
	];
	const turns = transcriptTurns({ items, status: "idle" } as CodexSessionState);
	const turn = turns[0];
	expect(turn.answers.map((i) => i.id)).toEqual(["end"]);
	expect(turn.users.map((i) => i.id)).toEqual(["u"]);
	expect(groupActivities(turn.work).map((g) => g.map((i) => i.id))).toEqual([
		["a"],
		["c", "f"],
	]);
	expect(groupLabel(turn.work.slice(1))).toBe("Ran commands, edited files");
});

test("optimistic user prompt and waiting activity belong to one turn before acknowledgement", () => {
	const items: CodexItem[] = [
		{
			id: "local-user-1",
			turnId: "",
			kind: "user",
			title: "",
			text: "Visible prompt",
		},
	];
	const turns = transcriptTurns({
		items,
		status: "working",
		turnId: null,
		workingSince: 1000,
	} as CodexSessionState);
	expect(turns).toHaveLength(1);
	expect(turns[0]).toMatchObject({ active: true, timing: { startedAt: 1000 } });
	expect(turns[0].users[0].text).toBe("Visible prompt");
});

test("diff counts exclude patch headers", () => {
	expect(
		diffStats([
			{
				path: "a",
				kind: "update",
				diff: "--- a\n+++ b\n@@ -1 +1 @@\n-one\n+two\n+three",
			},
		]),
	).toEqual({ added: 2, removed: 1 });
});
