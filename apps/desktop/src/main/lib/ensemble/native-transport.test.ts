import { beforeEach, expect, mock, test } from "bun:test";
import type { ClaudeStreamEvent } from "../../../shared/claude-session/events";
import type { CodexSessionState } from "../../../shared/codex-session/types";
import type { EnsembleMember } from "../../../shared/ensemble";

const member: EnsembleMember = {
	id: "m1",
	key: "pane",
	provider: "codex",
	conversationId: "thread",
	title: "Director",
	role: "Coordinator",
	cwd: "C:/project",
};
const marker = "[Ensemble message test-delivery]";
let state: CodexSessionState;
let events: ClaudeStreamEvent[] = [];
let busy = false;
let activity = "idle";
let sent: unknown;
mock.module("../codex-session/session-manager", () => ({
	codexSessionManager: {
		get: () => state,
		listSessions: () => [state],
		send: async (input: unknown) => {
			sent = input;
		},
		interrupt: async () => {},
	},
}));
mock.module("../claude-session/session-manager", () => ({
	claudeSessionManager: {
		listSessions: () => [{ key: "pane", sessionId: "thread", running: true }],
		getContext: () => ({ cwd: "C:/project" }),
		isBusy: () => busy,
		getBufferedEvents: () => events,
		send: () => {},
		interrupt: () => {},
	},
}));
mock.module("../notifications/session-events", () => ({
	sessionEvents: { get: () => ({ status: activity }) },
}));
mock.module("../session-names", () => ({
	sessionNames: { get: () => "Reviewer" },
}));
const { NativeEnsembleTransport } = await import("./native-transport");
const transport = new NativeEnsembleTransport();
beforeEach(() => {
	busy = false;
	activity = "idle";
	sent = undefined;
	events = [];
	state = {
		key: "pane",
		threadId: "thread",
		cwd: "C:/project",
		title: "Director",
		model: "current-model",
		effort: "high",
		permission: "read-only",
		status: "idle",
		turnId: null,
		items: [
			{ id: "user", turnId: "turn", kind: "user", title: "", text: marker },
		],
		turns: [{ id: "turn", status: "completed" }],
		approvals: [],
		error: null,
		historyCursor: null,
		diff: "",
		contextTokens: 0,
		contextWindow: 0,
	};
});
test("Codex commentary and working turns never count as an answer", async () => {
	state.items.push({
		id: "commentary",
		turnId: "turn",
		kind: "assistant",
		phase: "commentary",
		title: "",
		text: "Still working",
	});
	state.status = "working";
	expect(
		(await transport.inspect(member, "test-delivery")).response,
	).toBeUndefined();
	state.status = "idle";
	state.items.push({
		id: "final",
		turnId: "turn",
		kind: "assistant",
		phase: "final_answer",
		title: "",
		text: "Final contribution",
	});
	expect(
		(await transport.inspect(member, "test-delivery")).response?.text,
	).toBe("Final contribution");
});
test("interrupted native turns become explicit failures instead of hanging forever", async () => {
	state.turns = [{ id: "turn", status: "interrupted" }];
	state.error = "Stopped";
	expect((await transport.inspect(member, "test-delivery")).response).toEqual({
		text: "Stopped",
		successful: false,
	});
});
test("new user input prevents attributing a later answer to the group", async () => {
	state.items.push({
		id: "new",
		turnId: "next",
		kind: "user",
		title: "",
		text: "An unrelated instruction",
	});
	expect((await transport.inspect(member, "test-delivery")).intervened).toBe(
		true,
	);
});
test("native sends preserve model, effort, and restricted permissions", async () => {
	await transport.send(member, marker, "test-delivery");
	expect(sent).toMatchObject({
		model: "current-model",
		effort: "high",
		permission: "read-only",
	});
	state.approvals = [
		{
			id: "question",
			method: "requestUserInput",
			title: "Question",
			detail: "",
			questions: [],
		},
	];
	await expect(transport.send(member, marker, "test-delivery")).rejects.toThrow(
		"busy",
	);
});
test("Claude waits for its terminal result and ignores child-agent text", async () => {
	// Minimal native protocol fixtures; only a terminal result is an acknowledgment.
	events = [
		{
			type: "local_user_message",
			id: "user",
			text: marker,
			timestamp: Date.now(),
		} as ClaudeStreamEvent,
		{
			type: "assistant",
			parent_tool_use_id: "child",
			message: { content: [{ type: "text", text: "Unrelated child output" }] },
		} as ClaudeStreamEvent,
		{
			type: "assistant",
			parent_tool_use_id: null,
			message: { content: [{ type: "text", text: "Reviewed result" }] },
		} as ClaudeStreamEvent,
	];
	const reviewer = { ...member, provider: "claude" as const };
	expect(
		(await transport.inspect(reviewer, "test-delivery")).response,
	).toBeUndefined();
	events.push({
		type: "result",
		result: "Reviewed result",
		is_error: false,
	} as ClaudeStreamEvent);
	busy = true;
	expect(
		(await transport.inspect(reviewer, "test-delivery")).response,
	).toBeUndefined();
	busy = false;
	expect((await transport.inspect(reviewer, "test-delivery")).response).toEqual(
		{ text: "Reviewed result", successful: true },
	);
});
