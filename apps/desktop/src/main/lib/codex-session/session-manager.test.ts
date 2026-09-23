import { afterEach, describe, expect, test } from "bun:test";
import {
	normalizeCodexItem,
	record,
} from "../../../shared/codex-session/types";
import { CodexSessionManager } from "./session-manager";
import { CodexRpcError, CodexTransport } from "./transport";

class FakeTransport extends CodexTransport {
	calls: Array<{ method: string; params: Record<string, unknown> }> = [];
	replies: Array<{ id: string | number; result: unknown }> = [];
	legacy = false;
	notImplemented = false;
	notLoadedRead = false;
	failSend = false;
	sendGate?: Promise<void>;
	active = false;
	historyEntries?: unknown[];
	historyFailureCursor?: string;
	steerFailure?: () => void;
	async request(method: string, params: unknown = {}): Promise<unknown> {
		const p = record(params);
		this.calls.push({ method, params: p });
		if (method === "turn/steer") this.steerFailure?.();
		if (method === "thread/read" && this.notLoadedRead && !p.includeTurns)
			throw new CodexRpcError("thread not loaded: saved", -32000);
		if (method === "project/list")
			return {
				data: [{ id: "workspace-project", roots: [{ path: "/workspace" }] }],
			};
		if (method === "model/list")
			return {
				data: [
					{
						id: "astra",
						model: "gpt-6-astra",
						displayName: "Astra",
						defaultReasoningEffort: "medium",
						supportedReasoningEfforts: [
							{ reasoningEffort: "low" },
							{ reasoningEffort: "medium" },
							{ reasoningEffort: "xhigh" },
						],
					},
				],
			};
		if (
			method === "thread/start" ||
			method === "thread/resume" ||
			method === "thread/fork" ||
			method === "thread/read"
		)
			return {
				model: "gpt-6-astra",
				reasoningEffort: "medium",
				thread: {
					id: method === "thread/fork" ? "fork-id" : "original-id",
					cwd: "/workspace",
					status: { type: this.active ? "active" : "idle" },
					turns: [
						{
							id: "old-turn",
							items: [
								{
									id: "legacy-message",
									type: "agentMessage",
									text: "Legacy history",
								},
							],
						},
					],
				},
			};
		if (method === "thread/items/list") {
			if (this.notImplemented)
				throw new CodexRpcError(
					"thread/items/list is not supported yet",
					-32000,
				);
			if (this.legacy) throw new CodexRpcError("Unknown method", -32601);
			if (p.cursor === this.historyFailureCursor && p.cursor)
				throw new Error("History request failed");
			if (this.historyEntries) {
				const offset = Number(p.cursor ?? 0);
				const end = offset + Math.min(100, Number(p.limit));
				return {
					data: this.historyEntries.slice(offset, end),
					nextCursor: end < this.historyEntries.length ? String(end) : null,
				};
			}
			return {
				data: [
					{
						turnId: "old-turn",
						item: {
							id: p.cursor ? "earlier" : "recent",
							type: "agentMessage",
							text: p.cursor ? "Earlier history" : "Recent history",
						},
					},
				],
				nextCursor: p.cursor ? null : "page2",
			};
		}
		if (method === "turn/start") {
			await this.sendGate;
			if (this.failSend) throw new Error("Model unavailable");
			return { turn: { id: "turn-id" } };
		}
		return {};
	}
	respond(id: string | number, result: unknown) {
		this.replies.push({ id, result });
	}
	reject(id: string | number, message: string) {
		this.replies.push({ id, result: { error: message } });
	}
}

const managers: CodexSessionManager[] = [];
const fixture = () => {
	const transport = new FakeTransport();
	const manager = new CodexSessionManager(transport);
	managers.push(manager);
	return { manager, transport };
};
afterEach(() => {
	for (const manager of managers.splice(0)) manager.dispose();
});

describe("native Codex session lifecycle", () => {
	test("GatedSpace async answers steer active work, survive completion and retain failed answers for retry", async () => {
		const { manager, transport } = fixture();
		const state = await manager.start({ key: "async", cwd: "/workspace" });
		const start = () =>
			transport.emit("notification", {
				method: "turn/started",
				params: {
					threadId: state.threadId,
					turn: { id: "active", status: "inProgress" },
				},
			});
		const complete = () =>
			transport.emit("notification", {
				method: "turn/completed",
				params: {
					threadId: state.threadId,
					turn: { id: "active", status: "completed" },
				},
			});
		start();
		const ask = () =>
			transport.askUser?.({
				session: "codex:async",
				questions: [{ title: "Which color?", options: ["Teal", "Amber"] }],
			}) ?? "";
		const id = ask();
		await manager.answer("async", id, true, { "0": "Teal" });
		expect(transport.calls.at(-1)).toMatchObject({
			method: "turn/steer",
			params: {
				expectedTurnId: "active",
				input: [{ type: "text", text: "Question: Which color?\nAnswer: Teal" }],
			},
		});
		expect(state.status).toBe("working");
		expect(state.approvals).toHaveLength(0);
		const later = ask();
		complete();
		expect(state.approvals).toHaveLength(1);
		await manager.answer("async", later, true, { "0": "Custom color" });
		expect(transport.calls.at(-1)?.method).toBe("turn/start");
		expect(transport.calls.at(-1)?.params).not.toHaveProperty("approvalPolicy");
		start();
		const retry = ask();
		transport.steerFailure = () => {
			throw new Error("Connection dropped");
		};
		await expect(
			manager.answer("async", retry, true, { "0": "Teal" }),
		).rejects.toThrow("Connection dropped");
		expect(state.approvals).toHaveLength(1);
		transport.steerFailure = () => {
			complete();
			throw new Error("No active turn");
		};
		await manager.answer("async", retry, true, { "0": "Teal" });
		expect(transport.calls.at(-1)?.method).toBe("turn/start");
		expect(state.approvals).toHaveLength(0);
		expect(() =>
			transport.askUser?.({
				session: "codex:unknown",
				questions: [{ title: "Question" }],
			}),
		).toThrow();
	});
	test("async questions survive completion, validate answers and resolve exactly once", async () => {
		const { manager, transport } = fixture();
		const state = await manager.start({ key: "question", cwd: "/workspace" });
		const message = {
			id: 71,
			method: "item/tool/requestUserInput",
			params: {
				threadId: state.threadId,
				turnId: "turn",
				isBlocking: false,
				questions: [
					{
						id: "color",
						question: "Which color?",
						options: [
							{ label: "Teal", description: "Use teal" },
							{ label: "Amber" },
						],
					},
				],
			},
		};
		transport.emit("request", message);
		transport.emit("request", message);
		expect(state.approvals).toHaveLength(1);
		expect(state.approvals[0]).toMatchObject({
			isBlocking: false,
			questions: [
				{
					id: "color",
					question: "Which color?",
					options: ["Teal", "Amber"],
					descriptions: ["Use teal", ""],
				},
			],
		});
		transport.emit("notification", {
			method: "turn/completed",
			params: {
				threadId: state.threadId,
				turn: { id: "turn", status: "completed" },
			},
		});
		expect(state.approvals).toHaveLength(1);
		expect(() => manager.answer("question", "number:71", true, {})).toThrow(
			"Answer each",
		);
		expect(() =>
			manager.answer("question", "number:71", true, {
				color: "Teal",
				unknown: "bad",
			}),
		).toThrow("Answer each");
		expect(() =>
			manager.answer("another-pane", "number:71", true, { color: "Teal" }),
		).toThrow("no longer pending");
		expect(transport.replies).toHaveLength(0);
		manager.answer("question", "number:71", true, { color: "Custom response" });
		expect(transport.replies).toEqual([
			{
				id: 71,
				result: { answers: { color: { answers: ["Custom response"] } } },
			},
		]);
		expect(state.approvals).toHaveLength(0);
		expect(() =>
			manager.answer("question", "number:71", true, { color: "Teal" }),
		).toThrow("no longer pending");
		transport.emit("request", { ...message, id: 72 });
		transport.emit("notification", {
			method: "serverRequest/resolved",
			params: { threadId: state.threadId, requestId: 72 },
		});
		expect(state.approvals).toHaveLength(0);
		expect(() =>
			manager.answer("question", "number:72", true, { color: "Teal" }),
		).toThrow("no longer pending");
	});
	test("optimistic image previews survive a text-only echo and arbitrary attachments are refused", async () => {
		const { manager, transport } = fixture();
		const state = await manager.start({ key: "image-echo", cwd: "/workspace" });
		await manager.send({
			key: "image-echo",
			text: "Screenshot",
			images: ["data:image/png;base64,YWJj"],
			model: "gpt-6-astra",
			effort: "xhigh",
			permission: "default",
		});
		expect(state.items[0].images).toEqual(["data:image/png;base64,YWJj"]);
		transport.emit("notification", {
			method: "item/completed",
			params: {
				threadId: state.threadId,
				turnId: "turn-id",
				item: {
					id: "echo",
					type: "userMessage",
					content: [{ type: "text", text: "Screenshot" }],
				},
			},
		});
		expect(state.items).toHaveLength(1);
		expect(state.items[0].images).toEqual(["data:image/png;base64,YWJj"]);
		await expect(manager.attachment("image-echo", "echo", 0)).rejects.toThrow();
		await expect(
			manager.attachment("image-echo", "C:/sensitive.png", 0),
		).rejects.toThrow();
	});
	test("turn diffs remain scoped to their task across completion and late events", async () => {
		const { manager, transport } = fixture();
		const state = await manager.start({ key: "review", cwd: "/workspace" });
		for (const [turnId, diff] of [
			["first", "first patch"],
			["second", "second patch"],
		]) {
			transport.emit("notification", {
				method: "turn/started",
				params: {
					threadId: state.threadId,
					turn: { id: turnId, status: "inProgress" },
				},
			});
			transport.emit("notification", {
				method: "turn/diff/updated",
				params: { threadId: state.threadId, turnId, diff },
			});
			transport.emit("notification", {
				method: "turn/completed",
				params: {
					threadId: state.threadId,
					turn: { id: turnId, status: "completed" },
				},
			});
		}
		transport.emit("notification", {
			method: "turn/diff/updated",
			params: {
				threadId: state.threadId,
				turnId: "first",
				diff: "final first patch",
			},
		});
		expect(state.turns?.find((t) => t.id === "first")).toMatchObject({
			status: "completed",
			diff: "final first patch",
		});
		expect(state.turns?.find((t) => t.id === "second")).toMatchObject({
			status: "completed",
			diff: "second patch",
		});
		expect(state.status).toBe("idle");
	});
	test("a late start acknowledgement cannot reopen a completed turn", async () => {
		const { manager, transport } = fixture();
		const state = await manager.start({ key: "late", cwd: "/workspace" });
		let release = () => {};
		transport.sendGate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const sent = manager.send({
			key: "late",
			text: "hello",
			model: "gpt-6-astra",
			effort: "xhigh",
			permission: "default",
		});
		for (const method of ["turn/started", "turn/completed"]) {
			transport.emit("notification", {
				method,
				params: {
					threadId: state.threadId,
					turn: {
						id: "turn-id",
						status: method.endsWith("completed") ? "completed" : "inProgress",
					},
				},
			});
		}
		release();
		await sent;
		expect(state.status).toBe("idle");
		expect(state.turnId).toBeNull();
		expect(state.turns?.[0].status).toBe("completed");
		expect(state.items[0].turnId).toBe("turn-id");
	});
	test("shows the prompt before acknowledgement and reconciles delayed server echoes once", async () => {
		const { manager, transport } = fixture();
		await manager.start({ key: "optimistic", cwd: "/workspace" });
		let release = () => {};
		transport.sendGate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const sent = manager.send({
			key: "optimistic",
			text: "Keep this prompt visible",
			model: "gpt-6-astra",
			effort: "xhigh",
			permission: "default",
		});
		expect(manager.get("optimistic")?.items.map((i) => i.text)).toEqual([
			"Keep this prompt visible",
		]);
		expect(manager.get("optimistic")?.status).toBe("working");
		release();
		await sent;
		const params = {
			threadId: "original-id",
			turnId: "turn-id",
			item: {
				id: "server-user",
				type: "userMessage",
				content: [{ type: "text", text: "Keep this prompt visible" }],
			},
		};
		transport.emit("notification", { method: "item/started", params });
		transport.emit("notification", { method: "item/completed", params });
		expect(manager.get("optimistic")?.items).toHaveLength(1);
		expect(manager.get("optimistic")?.items[0].id).toBe("server-user");
	});
	test("failed submission rolls back its local echo so retry cannot duplicate it", async () => {
		const { manager, transport } = fixture();
		await manager.start({ key: "failure", cwd: "/workspace" });
		transport.failSend = true;
		await expect(
			manager.send({
				key: "failure",
				text: "Retry me",
				model: "gpt-6-astra",
				effort: "xhigh",
				permission: "default",
			}),
		).rejects.toThrow();
		expect(manager.get("failure")?.items).toHaveLength(0);
		expect(manager.get("failure")?.status).toBe("idle");
	});
	test("projects and real plan/fast settings reach the app-server", async () => {
		const { manager, transport } = fixture();
		await manager.start({ key: "controls", cwd: "/workspace" });
		expect(
			transport.calls.find((c) => c.method === "thread/start")?.params
				.projectId,
		).toBe("workspace-project");
		await manager.send({
			key: "controls",
			text: "Plan this change",
			model: "gpt-6-astra",
			effort: "xhigh",
			permission: "default",
			plan: true,
			fast: true,
		});
		const turn = transport.calls.find((c) => c.method === "turn/start")?.params;
		expect(turn?.serviceTier).toBe("fast");
		expect(turn?.collaborationMode).toEqual({
			mode: "plan",
			settings: {
				model: "gpt-6-astra",
				reasoning_effort: "xhigh",
				developer_instructions: null,
			},
		});
		expect(turn?.approvalPolicy).toBe("on-request");
	});

	test("reconnect loads a saved thread when metadata reads require a loaded thread", async () => {
		const { manager, transport } = fixture();
		transport.notLoadedRead = true;
		const state = await manager.start({
			key: "saved",
			cwd: "/workspace",
			resumeSessionId: "saved-id",
		});
		expect(state.status).toBe("idle");
		expect(transport.calls.some((c) => c.method === "thread/resume")).toBe(
			true,
		);
	});

	test("starts at Extra High and reconnects the same saved thread after a disconnect", async () => {
		const { manager, transport } = fixture();
		const first = await manager.start({ key: "reconnect", cwd: "/workspace" });
		expect(first.effort).toBe("xhigh");
		expect(
			transport.calls.find((c) => c.method === "thread/start")?.params.config,
		).toEqual({
			model_reasoning_effort: "xhigh",
			"features.default_mode_request_user_input": true,
		});
		transport.emit("disconnected", new Error("Connection closed"));
		expect(manager.get("reconnect")?.status).toBe("error");
		const next = await manager.start({ key: "reconnect", cwd: "/workspace" });
		expect(next.status).toBe("idle");
		expect(next.threadId).toBe(first.threadId);
		expect(
			transport.calls.filter((c) => c.method === "thread/start"),
		).toHaveLength(1);
		expect(transport.calls.some((c) => c.method === "thread/resume")).toBe(
			true,
		);
	});
	test("falls back when a recognized history method is not implemented by this CLI", async () => {
		const { manager, transport } = fixture();
		transport.notImplemented = true;
		const state = await manager.start({
			key: "history",
			cwd: "/workspace",
			resumeSessionId: "saved",
		});
		expect(state.status).toBe("idle");
		expect(state.items[0]?.text).toBe("Legacy history");
	});

	test("closing while a send is starting waits for the turn ID and interrupts it", async () => {
		const { manager, transport } = fixture();
		await manager.start({ key: "a", cwd: "/workspace" });
		let accept = () => {};
		transport.sendGate = new Promise<void>((resolve) => {
			accept = resolve;
		});
		const send = manager.send({
			key: "a",
			text: "hello",
			model: "gpt-6-astra",
			effort: "low",
			permission: "default",
		});
		const close = manager.close("a");
		await Promise.resolve();
		expect(transport.calls.some((c) => c.method === "thread/unsubscribe")).toBe(
			false,
		);
		accept();
		await Promise.all([send, close]);
		expect(
			transport.calls.find((c) => c.method === "turn/interrupt")?.params.turnId,
		).toBe("turn-id");
		expect(manager.get("a")).toBeUndefined();
	});
	test("simultaneous panes cannot both resume one conversation", async () => {
		const { manager, transport } = fixture();
		const results = await Promise.allSettled(
			["a", "b"].map((key) =>
				manager.start({
					key,
					cwd: "/workspace",
					resumeSessionId: "original-id",
				}),
			),
		);
		expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
		expect(
			transport.calls.filter((c) => c.method === "thread/resume"),
		).toHaveLength(1);
	});
	test("closing during startup releases the newly created thread", async () => {
		const { manager, transport } = fixture();
		const start = manager.start({ key: "a", cwd: "/workspace" });
		await manager.close("a");
		await start;
		expect(manager.get("a")).toBeUndefined();
		expect(manager.liveIds()).toEqual([]);
		expect(transport.calls.at(-1)?.method).toBe("thread/unsubscribe");
	});
	test("a completed turn invalidates unanswered approvals", async () => {
		const { manager, transport } = fixture();
		const state = await manager.start({ key: "a", cwd: "/workspace" });
		transport.emit("request", {
			id: 9,
			method: "item/fileChange/requestApproval",
			params: { threadId: state.threadId },
		});
		transport.emit("notification", {
			method: "turn/completed",
			params: { threadId: state.threadId, turn: { status: "completed" } },
		});
		expect(() => manager.answer("a", "number:9", true)).toThrow(
			"no longer pending",
		);
		expect(transport.replies).toHaveLength(0);
	});
	test("concurrent mounts start only one thread and discover Astra", async () => {
		const { manager, transport } = fixture();
		const [a, b] = await Promise.all([
			manager.start({ key: "a", cwd: "/workspace" }),
			manager.start({ key: "a", cwd: "/workspace" }),
		]);
		expect(a.threadId).toBe(b.threadId);
		expect(
			transport.calls.filter((c) => c.method === "thread/start"),
		).toHaveLength(1);
		expect(
			transport.calls.find((c) => c.method === "thread/start")?.params.model,
		).toBe("gpt-6-astra");
	});
	test("a second pane cannot acquire the same thread, but a fork can", async () => {
		const { manager } = fixture();
		await manager.start({ key: "a", cwd: "/workspace" });
		await expect(
			manager.start({
				key: "b",
				cwd: "/workspace",
				resumeSessionId: "original-id",
			}),
		).rejects.toThrow("already open");
		const fork = await manager.start({
			key: "c",
			cwd: "/workspace",
			resumeSessionId: "original-id",
			forkSession: true,
		});
		expect(fork.threadId).toBe("fork-id");
	});
	test("active external threads require a fork", async () => {
		const { manager, transport } = fixture();
		transport.active = true;
		await expect(
			manager.start({
				key: "a",
				cwd: "/workspace",
				resumeSessionId: "original-id",
			}),
		).rejects.toThrow("another client");
		expect(transport.calls.some((c) => c.method === "thread/resume")).toBe(
			false,
		);
	});
	test("loads three capped history pages initially and per click, preserving order and newer visible items", async () => {
		const { manager, transport } = fixture();
		transport.historyEntries = Array.from({ length: 750 }, (_, i) => ({
			turnId: "old-turn",
			item: {
				id: `item-${749 - i}`,
				type: "agentMessage",
				text: `Saved message ${749 - i}`,
			},
		}));
		const state = await manager.start({
			key: "a",
			cwd: "/workspace",
			resumeSessionId: "original-id",
		});
		expect(state.items.length).toBe(300);
		expect(state.items[0].id).toBe("item-450");
		expect(state.items.at(-1)?.id).toBe("item-749");
		expect(state.historyCursor).toBe("300");
		state.items.unshift({
			id: "item-449",
			turnId: "old-turn",
			kind: "assistant",
			title: "",
			text: "Newer live content",
		});
		await manager.earlier("a");
		expect(state.items.length).toBe(600);
		expect(state.items[0].id).toBe("item-150");
		expect(state.items.find((i) => i.id === "item-449")?.text).toBe(
			"Newer live content",
		);
		expect(state.historyCursor).toBe("600");
		await manager.earlier("a");
		expect(state.items.map((i) => i.id)).toEqual(
			Array.from({ length: 750 }, (_, i) => `item-${i}`),
		);
		expect(state.historyCursor).toBeNull();
		expect(
			transport.calls.filter((c) => c.method === "thread/items/list").length,
		).toBe(8);
		await manager.earlier("a");
		expect(
			transport.calls.filter((c) => c.method === "thread/items/list").length,
		).toBe(8);
	});
	test("a failed history batch retains its cursor and messages for a safe retry", async () => {
		const { manager, transport } = fixture();
		transport.historyEntries = Array.from({ length: 650 }, (_, i) => ({
			turnId: "old-turn",
			item: {
				id: `item-${649 - i}`,
				type: "agentMessage",
				text: "Saved message",
			},
		}));
		const state = await manager.start({
			key: "a",
			cwd: "/workspace",
			resumeSessionId: "original-id",
		});
		const original = state.items;
		transport.historyFailureCursor = "400";
		await expect(manager.earlier("a")).rejects.toThrow(
			"History request failed",
		);
		expect(state.items).toBe(original);
		expect(state.historyCursor).toBe("300");
		transport.historyFailureCursor = undefined;
		await manager.earlier("a");
		expect(state.items.length).toBe(600);
		expect(state.historyCursor).toBe("600");
	});
	test("falls back for legacy CLIs only when pagination is unsupported", async () => {
		const { manager, transport } = fixture();
		transport.legacy = true;
		const state = await manager.start({
			key: "a",
			cwd: "/workspace",
			resumeSessionId: "original-id",
		});
		expect(state.items[0]?.text).toBe("Legacy history");
	});
	test("streams text and command output once, then replaces with completed items", async () => {
		const { manager, transport } = fixture();
		const state = await manager.start({ key: "a", cwd: "/workspace" });
		const notify = (method: string, params: Record<string, unknown>) =>
			transport.emit("notification", {
				method,
				params: { threadId: state.threadId, turnId: "t", ...params },
			});
		notify("item/started", {
			item: { type: "agentMessage", id: "m", text: "" },
		});
		notify("item/agentMessage/delta", { itemId: "m", delta: "Hello" });
		expect(state.items[0]?.text).toBe("Hello");
		notify("item/completed", {
			item: { type: "agentMessage", id: "m", text: "Hello world" },
		});
		expect(state.items).toHaveLength(1);
		expect(state.items[0]?.text).toBe("Hello world");
		notify("item/started", {
			item: {
				type: "commandExecution",
				id: "c",
				command: "pwd",
				aggregatedOutput: "",
			},
		});
		notify("item/commandExecution/outputDelta", {
			itemId: "c",
			delta: "/workspace",
		});
		expect(state.items[1]?.text).toBe("/workspace");
	});
	test("never auto-approves and rejects cross-pane responses", async () => {
		const { manager, transport } = fixture();
		const state = await manager.start({ key: "a", cwd: "/workspace" });
		transport.emit("request", {
			id: 1,
			method: "item/commandExecution/requestApproval",
			params: { threadId: state.threadId, command: "echo test" },
		});
		expect(transport.replies).toHaveLength(0);
		expect(state.approvals).toHaveLength(1);
		expect(() => manager.answer("other", "number:1", true)).toThrow();
		manager.answer("a", "number:1", false);
		expect(transport.replies[0]?.result).toEqual({ decision: "decline" });
		expect(state.approvals).toHaveLength(0);
	});
	test("failed sends recover and interrupted turns settle", async () => {
		const { manager, transport } = fixture();
		const state = await manager.start({ key: "a", cwd: "/workspace" });
		transport.failSend = true;
		await expect(
			manager.send({
				key: "a",
				text: "hello",
				model: "gpt-6-astra",
				effort: "low",
				permission: "default",
			}),
		).rejects.toThrow("Model unavailable");
		expect(state.status).toBe("idle");
		transport.failSend = false;
		await manager.send({
			key: "a",
			text: "hello",
			model: "gpt-6-astra",
			effort: "low",
			permission: "default",
		});
		await manager.interrupt("a");
		expect(transport.calls.at(-1)?.params).toEqual({
			threadId: "original-id",
			turnId: "turn-id",
		});
		transport.emit("notification", {
			method: "turn/completed",
			params: { threadId: state.threadId, turn: { status: "interrupted" } },
		});
		expect(state.status).toBe("idle");
	});
	test("out-of-order deltas survive completion and a stopped turn never leaves a running tool", async () => {
		const { manager, transport } = fixture();
		const state = await manager.start({ key: "a", cwd: "/workspace" });
		const notify = (method: string, params: Record<string, unknown>) =>
			transport.emit("notification", {
				method,
				params: { threadId: state.threadId, turnId: "t", ...params },
			});
		notify("turn/started", { turn: { id: "t", startedAt: 100 } });
		notify("item/commandExecution/outputDelta", {
			itemId: "c",
			delta: "first line",
		});
		expect(state.items[0]).toMatchObject({
			text: "first line",
			activityType: "commandExecution",
			status: "inProgress",
		});
		notify("item/completed", {
			item: {
				id: "c",
				type: "commandExecution",
				command: "check",
				exitCode: 0,
				durationMs: 1250,
				aggregatedOutput: null,
			},
		});
		expect(state.items[0]).toMatchObject({
			text: "first line",
			exitCode: 0,
			durationMs: 1250,
			status: "completed",
		});
		notify("item/commandExecution/outputDelta", {
			itemId: "c",
			delta: "duplicate",
		});
		expect(state.items[0].text).toBe("first line");
		notify("item/started", {
			item: { id: "pending", type: "webSearch", query: "docs" },
		});
		notify("turn/completed", {
			turn: {
				id: "t",
				status: "interrupted",
				startedAt: 100,
				completedAt: 110,
				durationMs: 10000,
			},
		});
		expect(state.turns?.[0]).toMatchObject({
			id: "t",
			status: "interrupted",
			startedAt: 100000,
			completedAt: 110000,
			durationMs: 10000,
		});
		expect(state.items[1].status).toBe("interrupted");
		expect(state.items[1].completedAt).toBeNumber();
		expect(state.workingSince).toBeUndefined();
	});
	test("streaming public summary creates an activity even if its start arrives late", async () => {
		const { manager, transport } = fixture();
		const state = await manager.start({ key: "a", cwd: "/workspace" });
		transport.emit("notification", {
			method: "item/reasoning/summaryTextDelta",
			params: {
				threadId: state.threadId,
				turnId: "t",
				itemId: "r",
				delta: "Checking the layout",
			},
		});
		expect(state.items[0]).toMatchObject({
			activityType: "reasoning",
			text: "Checking the layout",
		});
		transport.emit("notification", {
			method: "item/started",
			params: {
				threadId: state.threadId,
				turnId: "t",
				item: { id: "r", type: "reasoning", summary: [] },
			},
		});
		expect(state.items[0].text).toBe("Checking the layout");
		transport.emit("notification", {
			method: "item/reasoning/textDelta",
			params: { threadId: state.threadId, itemId: "r", delta: "private" },
		});
		expect(state.items[0].text).toBe("Checking the layout");
	});
	test("preserves all user text parts and does not expose hook instructions", () => {
		expect(
			normalizeCodexItem(
				{
					type: "userMessage",
					id: "m",
					content: [
						{ type: "text", text: "one" },
						{ type: "text", text: "two" },
					],
				},
				"t",
			)?.text,
		).toBe("one\n\ntwo");
		expect(normalizeCodexItem({ type: "hookPrompt", id: "h" }, "t")).toBeNull();
	});
});
