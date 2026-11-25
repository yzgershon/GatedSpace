import { afterAll, beforeAll, expect, mock, test } from "bun:test";
import type { Server } from "node:http";
import express from "express";
import type { ClaudeStreamEvent } from "../../../shared/claude-session/events";
import type { CodexSessionState } from "../../../shared/codex-session/types";
import { SessionNameStore } from "../session-names/store";

const names = new SessionNameStore({
	load: () => ({ names: {}, aliases: {} }),
	save: () => {},
	legacy: () => null,
	mirror: () => {},
	generate: async () => null,
});
mock.module("../session-names", () => ({
	sessionNames: names,
	sessionNamingInstructions: () => "",
}));
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
let claudeBusy = false;
let claudeExtra: ClaudeStreamEvent[] = [];
let claudePermissions: Array<{ id: string; tool: string; input: object }> = [];
mock.module("../claude-session/session-manager", () => ({
	claudeSessionManager: {
		listSessions: () => [
			{ key: "claude-pane", sessionId: "claude-thread", running: true },
		],
		isRunning: () => true,
		isBusy: () => claudeBusy,
		getBufferedEvents: () => [
			{ type: "local_user_message", id: "user", text: "Claude prompt" },
			...claudeExtra,
			{ type: "local_permissions", requests: claudePermissions },
		],
		answerPermission: (...args: unknown[]) => {
			answers.push(args);
			claudePermissions = [];
		},
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
	loadSessionTranscript: async () => {
		await new Promise((resolve) => setTimeout(resolve, 5));
		return [
			{
				type: "user",
				uuid: "stored-prompt",
				parent_tool_use_id: null,
				message: { role: "user", content: "Earlier saved prompt" },
			},
		];
	},
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
test("a live Claude process is not reported as a working turn", async () => {
	const list = await (await fetch(`${origin}/sessions`)).json();
	expect(
		list.sessions.find((s: { provider: string }) => s.provider === "claude")
			.running,
	).toBe(false);
	claudeBusy = true;
	claudeExtra = [
		{ type: "local_notice", id: "stopped", text: "Stopped", fatal: true },
	];
	try {
		const response = await fetch(`${origin}/claude/claude-pane`);
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect((await response.json()).working).toBe(false);
	} finally {
		claudeExtra = [];
		claudeBusy = false;
	}
});
test("completed Claude results override late busy frames until the next user turn", async () => {
	claudeBusy = true;
	claudeExtra = [
		{
			type: "result",
			subtype: "success",
			is_error: false,
			result: "Done",
			session_id: "claude-thread",
			uuid: "done",
			num_turns: 1,
			duration_ms: 1,
			duration_api_ms: 1,
			total_cost_usd: 0,
			stop_reason: "end_turn",
			terminal_reason: "success",
			usage: {},
			modelUsage: {},
			permission_denials: [],
			api_error_status: null,
		},
	];
	try {
		expect(
			(await (await fetch(`${origin}/claude/claude-pane`)).json()).working,
		).toBe(false);
		claudeExtra.push({
			type: "local_user_message",
			id: "next",
			text: "Continue",
		});
		expect(
			(await (await fetch(`${origin}/claude/claude-pane`)).json()).working,
		).toBe(true);
	} finally {
		claudeExtra = [];
		claudeBusy = false;
	}
});

test("large Codex images load on demand instead of in every transcript poll", async () => {
	const original = codexState.items;
	const source = `data:image/png;base64,${"YQ==".repeat(100_000)}`;
	codexState.items = [
		{
			id: "photo",
			kind: "user",
			turnId: "turn",
			title: "",
			text: "Photo",
			images: [source],
		},
	];
	try {
		const response = await fetch(`${origin}/codex/pane`);
		const body = await response.text();
		expect(body.length).toBeLessThan(2_000);
		expect(JSON.parse(body).messages[0].images).toEqual([
			{ name: "Attached image", index: 0 },
		]);
		const image = await (
			await fetch(`${origin}/codex/pane/image/photo/0`)
		).json();
		expect(image.source).toBe(source);
	} finally {
		codexState.items = original;
	}
});

test("Codex command code stays behind the activity disclosure", async () => {
	const original = codexState.items;
	const command = 'powershell.exe -Command "Get-Content app.ts"';
	codexState.items = [
		{
			id: "command",
			turnId: "turn",
			kind: "activity",
			title: command,
			command,
			activityType: "commandExecution",
			text: "File contents",
		},
	];
	try {
		const page = await (await fetch(`${origin}/codex/pane`)).json();
		expect(page.messages[0]).toMatchObject({
			title: "Ran a command",
			text: "",
			detailAvailable: true,
		});
		expect(JSON.stringify(page)).not.toContain("powershell.exe");
		const detail = await (
			await fetch(`${origin}/codex/pane/activity/command`)
		).json();
		expect(detail.text).toContain(command);
		expect(detail.text).toContain("File contents");
	} finally {
		codexState.items = original;
	}
});

test("Claude saved images and question answers use the mobile contract", async () => {
	const source = "data:image/png;base64,YQ==";
	claudeExtra = [
		{
			type: "local_user_message",
			id: "photo",
			text: "",
			attachments: [
				{ name: "photo.png", mediaType: "image/png", thumbnail: source },
			],
		},
	];
	claudePermissions = [
		{
			id: "ask",
			tool: "AskUserQuestion",
			input: {
				questions: [
					{
						question: "Which layout?",
						options: [{ label: "Compact" }],
						multiSelect: false,
					},
				],
			},
		},
	];
	try {
		const data = await (await fetch(`${origin}/claude/claude-pane`)).json();
		expect(data.messages.at(-1).images).toEqual([
			{ name: "photo.png", index: 0 },
		]);
		expect(data.questions[0].questions[0].id).toBe("Which layout?");
		expect(
			(await (await fetch(`${origin}/claude/claude-pane/image/photo/0`)).json())
				.source,
		).toBe(source);
		expect(
			(await post("/claude/claude-pane/answer", { id: "ask", allow: true }))
				.status,
		).toBe(409);
		expect(
			(
				await post("/claude/claude-pane/answer", {
					id: "ask",
					allow: true,
					answers: { "Which layout?": "Compact" },
				})
			).status,
		).toBe(200);
		expect(answers.at(-1)).toEqual([
			"claude-pane",
			"ask",
			true,
			{ "Which layout?": "Compact" },
		]);
	} finally {
		claudeExtra = [];
		claudePermissions = [];
	}
});

test("Codex questions can be dismissed without inventing an answer", async () => {
	expect(
		(await post("/codex/pane/answer", { id: "question", allow: false })).status,
	).toBe(200);
	expect(answers.at(-1)).toEqual(["pane", "question", false, undefined]);
});
test("mobile direction reaches busy Claude once and retries do not duplicate it", async () => {
	const body = {
		requestId: crypto.randomUUID(),
		text: "Use this new direction while working",
	};
	const before = sent.length;
	claudeBusy = true;
	try {
		expect((await post("/claude/claude-pane/send", body)).status).toBe(200);
	} finally {
		claudeBusy = false;
	}
	expect((await post("/claude/claude-pane/send", body)).status).toBe(200);
	expect((await post("/claude/claude-pane/send", body)).status).toBe(200);
	expect(sent.length - before).toBe(1);
});

test("mobile Codex messages request steering with images during an active turn", async () => {
	const originalStatus = codexState.status;
	codexState.status = "working";
	try {
		const body = {
			requestId: crypto.randomUUID(),
			text: "Look at this screenshot",
			images: [{ name: "screen.png", mediaType: "image/png", data: "AAAA" }],
		};
		const before = sent.length;
		expect((await post("/codex/pane/send", body)).status).toBe(200);
		expect((await post("/codex/pane/send", body)).status).toBe(200);
		expect(sent.length - before).toBe(1);
		expect(sent.at(-1)).toMatchObject({
			key: "pane",
			steerIfWorking: true,
			images: ["data:image/png;base64,AAAA"],
		});
	} finally {
		codexState.status = originalStatus;
	}
});

test("large histories start with sixty messages and format only replies", async () => {
	const original = codexState.items;
	codexState.items = Array.from({ length: 1_000 }, (_, n) => ({
		id: String(n),
		kind: "assistant",
		turnId: "turn",
		title: "",
		text: `**Reply ${n}**`,
	}));
	try {
		const data = await (await fetch(`${origin}/codex/pane`)).json();
		expect(data.messages).toHaveLength(60);
		expect(data.hasEarlier).toBe(true);
		expect(data.messages.at(-1).html).toContain("<strong>Reply 999</strong>");
		const older = await (await fetch(`${origin}/codex/pane?before=940`)).json();
		expect(older.messages.at(-1).id).toBe("939");
	} finally {
		codexState.items = original;
	}
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
test("Claude waits for disk history before merging the live buffer", async () => {
	const data = await (await fetch(`${origin}/claude/claude-pane`)).json();
	expect(
		data.messages.map((message: { text: string }) => message.text),
	).toEqual(["Earlier saved prompt", "Claude prompt"]);
});
test("mobile direction leaves tool permissions pending for an explicit answer", async () => {
	const before = sent.length;
	claudePermissions = [{ id: "approval", tool: "Bash", input: {} }];
	try {
		expect(
			(
				await post("/claude/claude-pane/send", {
					requestId: crypto.randomUUID(),
					text: "Use the other file instead",
				})
			).status,
		).toBe(200);
		expect(sent.length).toBe(before + 1);
		expect(claudePermissions).toHaveLength(1);
		expect(
			(
				await post("/claude/claude-pane/answer", {
					id: "approval",
					allow: false,
				})
			).status,
		).toBe(200);
		expect(answers.at(-1)).toEqual(["claude-pane", "approval", false]);
		expect(
			(
				await post("/claude/claude-pane/answer", {
					id: "approval",
					allow: true,
				})
			).status,
		).toBe(409);
	} finally {
		claudePermissions = [];
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
test("personal phone messages use the owner's full-access default", async () => {
	const previous = process.env.GATEDSPACE_PERSONAL;
	process.env.GATEDSPACE_PERSONAL = "1";
	try {
		const response = await post("/codex/pane/send", {
			requestId: crypto.randomUUID(),
			text: "Personal phone prompt",
		});
		expect(response.status).toBe(200);
		expect(sent.at(-1)).toMatchObject({
			key: "pane",
			permission: "full-access",
		});
	} finally {
		if (previous === undefined) delete process.env.GATEDSPACE_PERSONAL;
		else process.env.GATEDSPACE_PERSONAL = previous;
	}
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

test("renames appear in both mobile lists and open conversations immediately", async () => {
	for (const [provider, id, key] of [
		["codex", "thread", "pane"],
		["claude", "claude-thread", "claude-pane"],
	] as const) {
		names.bind(provider, key, id);
		names.rename({ provider, key }, `Named ${provider}`);
		const list = await (await fetch(`${origin}/sessions`)).json();
		expect(
			list.sessions.find(
				(row: { provider: string }) => row.provider === provider,
			).title,
		).toBe(`Named ${provider}`);
		const conversation = await (
			await fetch(`${origin}/${provider}/${key}`)
		).json();
		expect(conversation.title).toBe(`Named ${provider}`);
	}
});

test("mobile direction can reach a busy Claude turn and idle status settles", async () => {
	const before = sent.length;
	claudeBusy = true;
	try {
		const view = await (await fetch(`${origin}/claude/claude-pane`)).json();
		expect(view.working).toBe(true);
		const response = await post("/claude/claude-pane/send", {
			requestId: crypto.randomUUID(),
			text: "New direction from my phone",
		});
		expect(response.status).toBe(200);
		expect(sent.length).toBe(before + 1);
	} finally {
		claudeBusy = false;
	}
	const view = await (await fetch(`${origin}/claude/claude-pane`)).json();
	expect(view.working).toBe(false);
});

test("mobile delivery preserves an explicitly restricted Codex session", async () => {
	const previous = codexState.permission;
	codexState.permission = "read-only";
	try {
		const response = await post("/codex/pane/send", {
			requestId: crypto.randomUUID(),
			text: "Keep the current permission",
		});
		expect(response.status).toBe(200);
		expect(sent.at(-1)).toMatchObject({ permission: "read-only" });
	} finally {
		codexState.permission = previous;
	}
});
