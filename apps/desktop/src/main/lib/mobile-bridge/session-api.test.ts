import { afterAll, beforeAll, expect, mock, test } from "bun:test";
import type { Server } from "node:http";
import express from "express";
import type { CodexSessionState } from "../../../shared/codex-session/types";

const codexState: CodexSessionState = {
	key: "pane",
	threadId: "thread",
	cwd: "C:/project",
	title: "Test",
	model: "test-model",
	effort: "high",
	status: "idle",
	turnId: null,
	items: [
		{ id: "prompt", turnId: "turn", kind: "user", title: "", text: "Hello" },
	],
	approvals: [
		{
			id: "question",
			method: "requestUserInput",
			title: "Choose",
			detail: "",
			questions: [{ id: "choice", question: "Which?", options: ["One"] }],
		},
	],
	error: null,
	historyCursor: null,
	diff: "",
	contextTokens: 42,
	contextWindow: 100,
};
const sent: unknown[] = [],
	answers: unknown[] = [];
const fakeCodex = {
	limits: async () => ({
		window: { description: "weekly window", usedPercent: 24, resets: null },
	}),
	get: (key: string) => (key === "pane" ? codexState : undefined),
	listSessions: () => [codexState],
	listThreads: async () => {
		throw new Error("Signed out");
	},
	readSummary: async () => ({ cwd: "C:/saved", title: "Saved" }),
	start: async (input: unknown) => {
		sent.push(input);
		return codexState;
	},
	send: async (input: unknown) => {
		sent.push(input);
	},
	interrupt: async () => {
		codexState.status = "idle";
	},
	answer: async (...input: unknown[]) => {
		answers.push(input);
	},
};
mock.module("../codex-session/session-manager", () => ({
	codexSessionManager: fakeCodex,
}));
mock.module("../claude-session/session-manager", () => ({
	claudeSessionManager: {
		listSessions: () => [
			{ key: "claude-pane", sessionId: "claude-thread", running: true },
		],
		isRunning: () => true,
		getBufferedEvents: () => [
			{ type: "local_user_message", id: "user", text: "Claude prompt" },
		],
		send: (...args: unknown[]) => sent.push(args),
		interrupt: () => {},
		start: (...args: unknown[]) => sent.push(args),
	},
}));
mock.module("../claude-sessions/claude-sessions", () => ({
	listClaudeSessions: () => [
		{ sessionId: "claude-thread", title: "Claude", cwd: "C:/project" },
	],
}));
mock.module("../claude-session/transcript", () => ({
	loadSessionTranscript: () => [],
}));
mock.module("./workspace-targets", () => ({
	listBridgeWorkspaceTargets: () => [
		{ id: "known", name: "Project", project: "Project", cwd: "C:/project" },
	],
}));
let server: Server, origin: string;
beforeAll(async () => {
	const { mobileSessionRouter } = await import("./session-api");
	const app = express();
	app.use(express.json());
	app.use(mobileSessionRouter());
	await new Promise<void>((resolve) => {
		server = app.listen(0, "127.0.0.1", () => resolve());
	});
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("No listener");
	origin = `http://127.0.0.1:${address.port}`;
});
afterAll(() => {
	server?.closeAllConnections();
	server?.close();
});
const post = (path: string, body: unknown) =>
	fetch(origin + path, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
test("Codex unavailable history does not hide live sessions from either provider", async () => {
	const data = await (await fetch(`${origin}/sessions`)).json();
	expect(data.sessions.map((s: { provider: string }) => s.provider)).toEqual([
		"claude",
		"codex",
	]);
	expect(data.warnings).toHaveLength(1);
});
test("both provider transcripts expose the same phone contract", async () => {
	for (const path of ["/codex/pane", "/claude/claude-pane"]) {
		const data = await (await fetch(origin + path)).json();
		expect(data.messages[0].kind).toBe("user");
		expect(typeof data.working).toBe("boolean");
	}
});
test("retrying a lost response calls the real route action once", async () => {
	const before = sent.length,
		body = { requestId: crypto.randomUUID(), text: "From phone" };
	const responses = await Promise.all([
		post("/codex/pane/send", body),
		post("/codex/pane/send", body),
	]);
	expect(responses.map((r) => r.status)).toEqual([200, 200]);
	expect(sent.length - before).toBe(1);
	expect(sent.at(-1)).toMatchObject({
		key: "pane",
		permission: "default",
		model: "test-model",
		text: "From phone",
	});
});
test("answer buttons and Other use the pending question ID", async () => {
	expect(
		(
			await post("/codex/pane/answer", {
				id: "question",
				allow: true,
				answers: { choice: "My custom answer" },
			})
		).status,
	).toBe(200);
	expect(answers.at(-1)).toEqual([
		"pane",
		"question",
		true,
		{ choice: "My custom answer" },
	]);
	expect(
		(await post("/codex/pane/answer", { id: "expired", allow: true })).status,
	).toBe(409);
	expect(
		(await post("/codex/pane/answer", { id: "question", allow: true })).status,
	).toBe(409);
});
test("unknown workspace and malformed provider cannot start an agent", async () => {
	const before = sent.length;
	expect(
		(
			await post("/new", {
				provider: "codex",
				workspaceId: "C:/secret",
				requestId: crypto.randomUUID(),
			})
		).status,
	).toBe(409);
	expect(
		(
			await post("/unknown/pane/send", {
				text: "hi",
				requestId: crypto.randomUUID(),
			})
		).status,
	).toBe(400);
	expect(sent.length).toBe(before);
});
test("resuming an already open Codex thread attaches to its existing pane", async () => {
	const before = sent.length;
	const data = await (
		await post("/resume", {
			provider: "codex",
			sessionId: "thread",
			requestId: crypto.randomUUID(),
		})
	).json();
	expect(data).toEqual({ key: "pane", provider: "codex" });
	expect(sent.length).toBe(before);
});

test("Codex usage keeps the provider reported window instead of inventing a session limit", async () => {
	const data = await (await fetch(`${origin}/usage/codex`)).json();
	expect(data.window).toEqual({
		description: "weekly window",
		usedPercent: 24,
		resets: null,
	});
});
