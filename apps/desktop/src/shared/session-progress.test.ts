import { expect, test } from "bun:test";
import { emptyTimeline } from "./claude-session/timeline";
import type { CodexSessionState } from "./codex-session/types";
import { claudeProgress, codexProgress } from "./session-progress";

const codex: CodexSessionState = {
	key: "pane",
	threadId: "thread",
	cwd: "C:/Dev",
	title: "Task",
	model: "model",
	effort: "high",
	status: "working",
	turnId: "turn",
	items: [],
	approvals: [],
	error: null,
	historyCursor: null,
	diff: "",
	contextTokens: null,
	contextWindow: null,
};
test("Codex activity never treats intermediate output or interrupted work as completion", () => {
	expect(
		codexProgress({
			...codex,
			items: [
				{
					id: "a",
					turnId: "turn",
					kind: "assistant",
					title: "",
					text: "Done with the first check",
				},
			],
		}).status,
	).toBe("working");
	expect(
		codexProgress({
			...codex,
			status: "idle",
			turns: [{ id: "turn", status: "interrupted" }],
		}).status,
	).toBe("idle");
	expect(
		codexProgress({
			...codex,
			status: "idle",
			turns: [{ id: "turn", status: "completed" }],
		}).status,
	).toBe("complete");
	expect(
		codexProgress({
			...codex,
			approvals: [
				{
					id: "q",
					method: "question",
					title: "Question",
					detail: "",
					questions: [],
				},
			],
		}).status,
	).toBe("question");
});
test("activity excludes reasoning and previous-turn details", () => {
	const value = codexProgress({
		...codex,
		items: [
			{
				id: "old",
				turnId: "old",
				kind: "assistant",
				text: "Old task",
				title: "",
			},
			{ id: "u", turnId: "turn", kind: "user", text: "New task", title: "" },
			{
				id: "r",
				turnId: "turn",
				kind: "activity",
				text: "Private",
				title: "Reasoning",
				activityType: "reasoning",
			},
		],
	});
	expect(value.events).toEqual([]);
	expect(value.detail).toBe("Working on your request");
});
test("Claude completion requires a successful result and a settled transport", () => {
	const timeline = {
		...emptyTimeline(),
		items: [
			{
				kind: "result" as const,
				id: "r",
				result: "Done",
				isError: false,
				costUsd: 0,
				durationMs: 10,
				numTurns: 1,
			},
		],
	};
	expect(claudeProgress({ ...timeline, status: "streaming" }).status).toBe(
		"working",
	);
	expect(claudeProgress({ ...timeline, status: "done" }).status).toBe(
		"complete",
	);
	expect(
		claudeProgress({
			...timeline,
			status: "done",
			items: [{ ...timeline.items[0], isError: true }],
		}).status,
	).toBe("error");
	expect(claudeProgress(emptyTimeline()).status).toBe("idle");
});
