import { afterEach, expect, mock, test } from "bun:test";
import { EventEmitter } from "node:events";
import type { ClaudeStreamEvent } from "../../../shared/claude-session/events";
import { USAGE_CONTINUE_MESSAGE } from "../../../shared/usage-recovery";
import type { ClaudeSessionOptions, ClaudeSessionTransport } from "./transport";

// No real CLI, credentials, transcripts, names, or cross-process locks are touched.
let canResume = true;
let heldElsewhere = false;
mock.module("./transcript", () => ({
	canResumeUnderConfigDir: () => canResume,
}));
mock.module("./usage-refresh", () => ({
	refreshProfileUsage: async () => null,
	readProfileQuotaReset: () => null,
}));
mock.module("./cost-store", () => ({
	getSessionCost: () => 0,
	recordSessionCost: () => {},
}));
mock.module("../session-names", () => ({
	sessionNames: { open: () => {}, bind: () => {}, firstPrompt: () => {} },
	sessionNamingInstructions: () => "",
}));
mock.module("@superset/shared/session-lock", () => ({
	acquireSessionLock: () => ({ ok: !heldElsewhere }),
	listHeldSessionIds: () => [],
	releaseSessionLock: () => {},
}));
const { ClaudeSessionManager } = await import("./session-manager");
const { sessionEvents } = await import("../notifications/session-events");

class Transport extends EventEmitter {
	sent: string[] = [];
	isRunning = false;
	autoInit = true;
	constructor(readonly options: ClaudeSessionOptions) {
		super();
	}
	start() {
		this.isRunning = true;
		if (this.autoInit) this.ready();
	}
	ready() {
		this.emit("event", {
			type: "system",
			subtype: "init",
			session_id: "saved-conversation",
			model: this.options.model,
		} as ClaudeStreamEvent);
	}
	sendUserMessage(text: string) {
		this.sent.push(text);
	}
	dispose() {
		this.isRunning = false;
	}
	interrupt() {}
	result() {
		this.emit("event", {
			type: "result",
			subtype: "success",
			is_error: false,
			result: "Usage limit",
			uuid: "result",
			session_id: "saved-conversation",
		});
	}
	quota() {
		this.emit("event", {
			type: "rate_limit_event",
			rate_limit_info: {
				status: "rejected",
				resetsAt: Date.now() / 1000 + 3600,
			},
		});
		this.result();
	}
}

const managers: InstanceType<typeof ClaudeSessionManager>[] = [];
function fixture(deferRestart = false) {
	const transports: Transport[] = [];
	const manager = new ClaudeSessionManager((options) => {
		const transport = new Transport(options);
		transport.autoInit = !(deferRestart && transports.length);
		transports.push(transport);
		return transport as unknown as ClaudeSessionTransport;
	});
	managers.push(manager);
	manager.start("pane", {
		cwd: "/fixture",
		configDir: "/fixture/account",
		model: "chosen-model",
		permissionMode: "manual",
		fast: true,
	});
	return { manager, transports, transport: transports[0] as Transport };
}
afterEach(() => {
	for (const manager of managers.splice(0)) manager.disposeAll();
	canResume = true;
	heldElsewhere = false;
});

test("restoring effort never appears as a reply, replay entry or completed prompt", () => {
	const { manager, transport } = fixture();
	manager.send("pane", "/effort xhigh", true);
	manager.send("pane", "/effort xhigh", true);
	manager.send("pane", "My actual request");
	const before = manager.getBufferedEvents("pane").length;
	transport.emit("event", {
		type: "result",
		subtype: "success",
		is_error: false,
		num_turns: 0,
		result: "Set effort level to xhigh",
	});
	expect(manager.getBufferedEvents("pane")).toHaveLength(before);
	expect(sessionEvents.get("pane")?.status).toBe("working");
	expect(transport.sent).toEqual(["/effort xhigh", "My actual request"]);
	transport.result();
	expect(manager.getBufferedEvents("pane")).toHaveLength(before + 1);
});

test("Claude quota is red, replayable and continues the same live conversation once", async () => {
	const { manager, transport } = fixture();
	manager.send("pane", "Existing request");
	transport.quota();
	expect(sessionEvents.get("pane")).toMatchObject({
		status: "error",
		usageBlocked: true,
	});
	expect(
		manager
			.getBufferedEvents("pane")
			.some((e) => e.type === "local_usage_recovery" && e.recovery),
	).toBe(true);
	await manager.usageRecovery.continue("pane");
	expect(transport.sent).toEqual(["Existing request", USAGE_CONTINUE_MESSAGE]);
	expect(manager.usageRecovery.get("pane")).toBeNull();
	expect(sessionEvents.get("pane")?.status).toBe("working");
});

test("a disconnected Claude continues its saved ID and retains account, effort, speed and permissions", async () => {
	const { manager, transport, transports } = fixture();
	manager.send("pane", "/effort max", true);
	manager.send("pane", "Existing request");
	transport.quota();
	transport.isRunning = false;
	transport.emit("exit", { code: 0, signal: null });
	await manager.usageRecovery.continue("pane");
	expect(transports).toHaveLength(2);
	expect(transports[1]?.options).toMatchObject({
		resumeSessionId: "saved-conversation",
		configDir: "/fixture/account",
		permissionMode: "manual",
		model: "chosen-model",
		fast: true,
		forkSession: false,
	});
	expect(transports[1]?.sent).toEqual(["/effort max", USAGE_CONTINUE_MESSAGE]);
});

test.each([
	"missing transcript",
	"another writer",
])("continuation refuses %s instead of silently creating a fork or new chat", async (reason) => {
	const { manager, transport, transports } = fixture();
	transport.quota();
	transport.isRunning = false;
	transport.emit("exit", { code: 0, signal: null });
	canResume = reason !== "missing transcript";
	heldElsewhere = reason === "another writer";
	await expect(manager.usageRecovery.continue("pane")).rejects.toThrow();
	expect(transports).toHaveLength(1);
	expect(transport.sent).toHaveLength(0);
	expect(manager.usageRecovery.get("pane")?.autoContinue).toBe(false);
});

test("an unresolved question is not answered or dismissed by continuation", async () => {
	const { manager, transport } = fixture();
	transport.quota();
	transport.emit("event", {
		type: "local_permissions",
		requests: [{ id: "q", tool: "AskUserQuestion", input: {} }],
	});
	await expect(manager.usageRecovery.continue("pane")).rejects.toThrow(
		"pending question",
	);
	expect(transport.sent).toHaveLength(0);
});

test("a manual message during reconnection cancels the automatic continuation", async () => {
	const { manager, transport, transports } = fixture(true);
	transport.quota();
	transport.isRunning = false;
	transport.emit("exit", { code: 0, signal: null });
	const continuation = manager.usageRecovery.continue("pane");
	manager.send("pane", "New direction from the user");
	transports[1]?.ready();
	await expect(continuation).rejects.toThrow("canceled");
	expect(transports[1]?.sent).toEqual(["New direction from the user"]);
	expect(manager.usageRecovery.get("pane")).toBeNull();
});
