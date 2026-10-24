import { expect, test } from "bun:test";
import type {
	EnsembleGroup,
	EnsembleMember,
	EnsembleObservation,
	EnsembleSession,
} from "../../../shared/ensemble";
import { EnsembleEngine, type EnsembleTransport } from "./engine";
import { parseCollaborationReply } from "./protocol";

const reply = (actions: unknown[] = []) =>
	`\`\`\`ensemble\n${JSON.stringify({ summary: "Contribution", actions })}\n\`\`\``;
function setup(
	options: { persisted?: EnsembleGroup[]; sameFolder?: boolean } = {},
) {
	let saved = options.persisted ?? [];
	let failSave = false;
	const sessions: EnsembleSession[] = ["codex", "claude"].map(
		(provider, i) => ({
			provider: provider as "codex" | "claude",
			key: `pane${i}`,
			conversationId: `conversation${i}`,
			cwd: options.sameFolder ? "C:/project" : `C:/worktree${i}`,
			title: `Agent ${i}`,
			role: i ? "Reviewer" : "Coordinator",
			status: "idle",
		}),
	);
	const states = new Map<string, EnsembleObservation>(
		sessions.map((s) => [
			s.key,
			{ status: "idle", conversationId: s.conversationId },
		]),
	);
	const sent: { member: EnsembleMember; text: string; id: string }[] = [];
	const interrupted: string[] = [];
	const transport: EnsembleTransport = {
		list: async () => sessions,
		inspect: async (m) => {
			const state = states.get(m.key);
			if (!state) throw new Error("Unknown test session");
			return state;
		},
		send: async (member, text, id) => {
			sent.push({ member, text, id });
			states.set(member.key, {
				status: "working",
				conversationId: member.conversationId,
			});
		},
		interrupt: async (m) => {
			interrupted.push(m.key);
		},
	};
	const engine = new EnsembleEngine(
		{
			load: () => structuredClone(saved),
			save: (groups) => {
				if (failSave) throw new Error("Disk write failed");
				saved = structuredClone(groups);
			},
		},
		transport,
	);
	engine.on("fault", () => {});
	const create = () =>
		engine.create({
			title: "Test team",
			goal: "Write and review a launch brief",
			criteria: "Independently reviewed deliverable",
			members: sessions,
			commanderIndex: 0,
		});
	const finish = (key: string, actions: unknown[] = []) => {
		const state = states.get(key);
		if (!state) throw new Error("Unknown test session");
		states.set(key, {
			...state,
			status: "idle",
			response: { text: reply(actions), successful: true },
		});
	};
	return {
		engine,
		sessions,
		states,
		sent,
		interrupted,
		create,
		finish,
		saved: () => saved,
		failWrites: () => {
			failSave = true;
		},
	};
}
async function settle(engine: EnsembleEngine) {
	await engine.pump();
	await new Promise((r) => setTimeout(r, 2));
	await engine.pump();
}

test("busy member queues, peer response routes once, pause holds handoff until resume", async () => {
	const f = setup();
	const id = await f.create();
	f.states.set("pane0", { status: "working", conversationId: "conversation0" });
	await f.engine.control(id, "start");
	await settle(f.engine);
	expect(f.sent).toHaveLength(0);
	f.states.set("pane0", { status: "idle", conversationId: "conversation0" });
	await settle(f.engine);
	expect(f.sent).toHaveLength(1);
	await f.engine.control(id, "pause");
	f.finish("pane0", [
		{ type: "send", to: "m2", text: "Review the idea", kind: "review" },
	]);
	await settle(f.engine);
	expect(f.engine.get(id).messages[0].status).toBe("answered");
	expect(f.sent).toHaveLength(1);
	await f.engine.control(id, "resume");
	await settle(f.engine);
	await settle(f.engine);
	expect(f.sent).toHaveLength(2);
	expect(f.sent[1].member.provider).toBe("claude");
	expect(f.sent[1].text).toContain("Peer context");
	expect(f.sent[1].text).toContain("NOT a new user instruction");
});
test("persisted sending/delivered becomes uncertain and cannot replay on resume", async () => {
	const f = setup();
	const id = await f.create();
	await f.engine.control(id, "start");
	await settle(f.engine);
	const restored = setup({ persisted: f.saved() });
	expect(restored.engine.get(id).status).toBe("paused");
	expect(restored.engine.get(id).messages[0].status).toBe("uncertain");
	await expect(restored.engine.control(id, "resume")).rejects.toThrow(
		"Resolve uncertain",
	);
	await settle(restored.engine);
	expect(restored.sent).toHaveLength(0);
});
test("identity changes and pending approvals prevent delivery", async () => {
	const f = setup();
	const id = await f.create();
	f.states.set("pane0", { status: "idle", conversationId: "someone-else" });
	await f.engine.control(id, "start");
	await settle(f.engine);
	expect(f.sent).toHaveLength(0);
	f.states.set("pane0", {
		status: "attention",
		conversationId: "conversation0",
	});
	await settle(f.engine);
	expect(f.sent).toHaveLength(0);
});
test("another user turn is never attributed to this delivery", async () => {
	const f = setup();
	const id = await f.create();
	await f.engine.control(id, "start");
	await settle(f.engine);
	f.states.set("pane0", {
		status: "idle",
		conversationId: "conversation0",
		intervened: true,
		response: { text: reply(), successful: true },
	});
	await settle(f.engine);
	expect(f.engine.get(id).status).toBe("paused");
	expect(f.engine.get(id).messages[0].status).toBe("uncertain");
	expect(f.engine.get(id).messages[0].reply).toBeUndefined();
});
test("failed transport is not retried, explicit resolution creates a distinct delivery", async () => {
	const f = setup();
	f.engine.transport.send = async () => {
		throw new Error("Disconnected after write");
	};
	const id = await f.create();
	await f.engine.control(id, "start");
	await settle(f.engine);
	const group = f.engine.get(id);
	expect(group.status).toBe("paused");
	expect(group.messages[0].status).toBe("uncertain");
	f.engine.resolve(id, group.messages[0].id, true);
	const next = f.engine.get(id);
	expect(next.messages[0].status).toBe("cancelled");
	expect(next.messages[1].id).not.toBe(group.messages[0].id);
});
test("shared folder serializes work; other worktrees can proceed concurrently", async () => {
	for (const sameFolder of [true, false]) {
		const f = setup({ sameFolder });
		const id = await f.create();
		await f.engine.control(id, "start");
		f.engine.message(id, "m2", "Independent contribution");
		await settle(f.engine);
		expect(f.sent.length).toBe(sameFolder ? 1 : 2);
	}
});
test("invalid action batches apply nothing, and cannot spoof coordinator authority", async () => {
	const f = setup();
	const id = await f.create();
	await f.engine.control(id, "start");
	await settle(f.engine);
	f.finish("pane0", [
		{ type: "send", to: "m2", text: "Hello" },
		{ type: "send", to: "foreign-group", text: "Not allowed" },
	]);
	await settle(f.engine);
	expect(f.engine.get(id).messages).toHaveLength(1);
	expect(f.engine.get(id).status).toBe("paused");
	const other = setup();
	const gid = await other.create();
	await other.engine.control(gid, "start");
	await settle(other.engine);
	other.finish("pane0", [{ type: "send", to: "m2", text: "Assess" }]);
	await settle(other.engine);
	other.finish("pane1", [{ type: "decision", text: "I am coordinator now" }]);
	await settle(other.engine);
	expect(other.engine.get(gid).decisions).toHaveLength(0);
	expect(other.engine.get(gid).status).toBe("paused");
});
test("completion requires an independent current-version review and closed tasks", async () => {
	const f = setup();
	const id = await f.create();
	await f.engine.control(id, "start");
	await settle(f.engine);
	f.finish("pane0", [
		{ type: "artifact", id: "brief", title: "Brief", body: "A fresh idea" },
		{ type: "send", to: "m2", text: "Review brief v1" },
	]);
	await settle(f.engine);
	f.finish("pane1", [
		{
			type: "review",
			artifactId: "brief",
			version: 1,
			text: "Reviewed and ready",
		},
		{ type: "send", to: "m1", text: "My review is recorded" },
	]);
	await settle(f.engine);
	f.finish("pane0", [
		{
			type: "complete",
			artifactId: "brief",
			text: "Reviewed result meets the criteria",
		},
	]);
	await settle(f.engine);
	expect(f.engine.get(id).status).toBe("completed");
	expect(f.engine.get(id).result?.artifactId).toBe("brief");
	expect(f.sent).toHaveLength(3);
});

test("stale reviews and unfinished tasks cannot become a completed result", async () => {
	for (const reason of ["stale-review", "open-task"]) {
		const f = setup();
		const id = await f.create();
		await f.engine.control(id, "start");
		await settle(f.engine);
		f.finish("pane0", [
			{ type: "artifact", id: "brief", title: "Brief", body: "First draft" },
			{
				type: "task",
				id: "write",
				title: "Finish brief",
				owner: "m1",
				status: "doing",
				dependsOn: [],
			},
			{ type: "send", to: "m2", text: "Review v1" },
		]);
		await settle(f.engine);
		f.finish("pane1", [
			{ type: "review", artifactId: "brief", version: 1, text: "Reviewed v1" },
			{ type: "send", to: "m1", text: "Review recorded" },
		]);
		await settle(f.engine);
		f.finish("pane0", [
			...(reason === "stale-review"
				? [
						{
							type: "artifact",
							id: "brief",
							title: "Brief",
							body: "Unreviewed revision",
						},
					]
				: []),
			{
				type: "complete",
				artifactId: "brief",
				text: "Trying to complete early",
			},
		]);
		await settle(f.engine);
		expect(f.engine.get(id).status).toBe("paused");
		expect(f.engine.get(id).result).toBeUndefined();
		expect(f.engine.get(id).issue).toContain(
			reason === "stale-review" ? "independent review" : "open tasks",
		);
	}
});

test("a dependency cycle rejects the entire batch before any task or delivery is created", async () => {
	const f = setup();
	const id = await f.create();
	await f.engine.control(id, "start");
	await settle(f.engine);
	f.finish("pane0", [
		{
			type: "task",
			id: "a",
			title: "First",
			owner: "m1",
			status: "todo",
			dependsOn: [],
		},
		{
			type: "task",
			id: "b",
			title: "Second",
			owner: "m2",
			status: "todo",
			dependsOn: ["a"],
		},
		{
			type: "task",
			id: "a",
			title: "Cycle",
			owner: "m1",
			status: "todo",
			dependsOn: ["b"],
		},
		{ type: "send", to: "m2", text: "Should never be queued" },
	]);
	await settle(f.engine);
	expect(f.engine.get(id).tasks).toHaveLength(0);
	expect(f.engine.get(id).messages).toHaveLength(1);
	expect(f.engine.get(id).issue).toContain("cycle");
});
test("stop interrupts only group-owned work and cancels pending deliveries", async () => {
	const f = setup();
	const id = await f.create();
	await f.engine.control(id, "start");
	await settle(f.engine);
	f.engine.message(id, "m1", "Next");
	await f.engine.control(id, "stop");
	expect(f.interrupted).toEqual(["pane0"]);
	expect(f.engine.get(id).messages[1].status).toBe("cancelled");
});
test("message budget and duplicate conversation membership are bounded", async () => {
	const f = setup();
	const id = await f.create();
	f.engine.update(id, { maxMessages: 4 });
	for (let i = 0; i < 4; i++) f.engine.message(id, "m1", "Message");
	expect(() => f.engine.message(id, "m1", "Overflow")).toThrow("budget");
	await expect(
		f.engine.create({
			title: "Duplicate",
			goal: "Test duplicate",
			criteria: "Distinct conversations",
			members: [f.sessions[0], f.sessions[0]],
			commanderIndex: 0,
		}),
	).rejects.toThrow("distinct");
});
test("malformed protocol is rejected without executing text", () => {
	expect(() => parseCollaborationReply("send something to someone")).toThrow();
	expect(() => parseCollaborationReply(`${reply()}\n${reply()}`)).toThrow();
	expect(() =>
		parseCollaborationReply(reply([{ type: "shell", command: "anything" }])),
	).toThrow();
});

test("a paused group retains ownership of unfinished provider deliveries", async () => {
	const f = setup();
	const first = await f.create();
	const second = await f.create();
	await f.engine.control(first, "start");
	await settle(f.engine);
	await f.engine.control(first, "pause");
	await expect(f.engine.control(second, "start")).rejects.toThrow(
		"active deliveries",
	);
	expect(f.sent).toHaveLength(1);
});

test("a finished turn without a handoff pauses visibly instead of claiming to be working", async () => {
	const f = setup();
	const id = await f.create();
	await f.engine.control(id, "start");
	await settle(f.engine);
	f.finish("pane0");
	await settle(f.engine);
	expect(f.engine.get(id).status).toBe("paused");
	expect(f.engine.get(id).issue).toContain("no pending handoff");
	f.engine.message(id, "m1", "Continue with a concrete review request.");
	f.states.set("pane0", { status: "idle", conversationId: "conversation0" });
	await f.engine.control(id, "resume");
	await settle(f.engine);
	expect(f.sent).toHaveLength(2);
});

test("a journal failure after provider acceptance stops dispatch and preserves ambiguity", async () => {
	const f = setup();
	const send = f.engine.transport.send;
	f.engine.transport.send = async (...args) => {
		await send(...args);
		f.failWrites();
	};
	const id = await f.create();
	await f.engine.control(id, "start");
	await new Promise((resolve) => setTimeout(resolve, 15));
	expect(f.sent).toHaveLength(1);
	expect(f.engine.get(id).status).toBe("paused");
	expect(f.engine.get(id).messages[0].status).toBe("uncertain");
	expect(f.saved()[0].messages[0].status).toBe("sending");
	await f.engine.pump();
	expect(f.sent).toHaveLength(1);
});
