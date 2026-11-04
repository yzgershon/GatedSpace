/** Run alone with Bun: mocks stay in this process, never in the app or unit suite. */
import { mock } from "bun:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { resolve } from "node:path";

const lib = resolve(import.meta.dirname, "../src/main/lib");
const statuses: string[] = [];
let releases = 0;
const transports: FakeTransport[] = [];
class FakeTransport extends EventEmitter {
	disposed = false;
	sent: string[] = [];
	constructor() {
		super();
		transports.push(this);
	}
	start() {}
	dispose() {
		this.disposed = true;
	}
	sendUserMessage(text: string) {
		this.sent.push(text);
	}
	get isRunning() {
		return !this.disposed;
	}
}
mock.module(resolve(lib, "claude-session/transport.ts"), () => ({
	ClaudeSessionTransport: FakeTransport,
}));
mock.module(resolve(lib, "app-environment.ts"), () => ({
	SUPERSET_HOME_DIR: "fixture-only",
}));
mock.module("@superset/shared/session-lock", () => ({
	acquireSessionLock: () => ({ ok: true }),
	releaseSessionLock: () => {
		releases++;
	},
	listHeldSessionIds: () => [],
}));
mock.module(resolve(lib, "session-names/index.ts"), () => ({
	sessionNames: { open() {}, bind() {}, firstPrompt() {} },
}));
mock.module(resolve(lib, "claude-session/cost-store.ts"), () => ({
	getSessionCost: () => 0,
	recordSessionCost() {},
}));
mock.module(resolve(lib, "claude-session/transcript.ts"), () => ({
	canResumeUnderConfigDir: () => true,
}));
mock.module(resolve(lib, "notifications/session-events.ts"), () => ({
	sessionEvents: {
		open() {},
		bind() {},
		close() {},
		status(_key: string, status: string) {
			statuses.push(status);
		},
	},
}));
mock.module(resolve(lib, "notifications/claude-turn-notifications.ts"), () => ({
	ClaudeTurnNotifications: class {
		clear() {}
		event() {}
		sent() {}
	},
}));
const { claudeSessionManager: manager } = await import(
	"../src/main/lib/claude-session/session-manager"
);
const key = "compaction-fixture";
manager.start(key, { cwd: "fixture-only" });
const transport = transports[0];
transport.emit("event", {
	type: "system",
	subtype: "init",
	session_id: "fixture-session",
	uuid: "init",
});
manager.send(key, "Keep this user instruction");
for (let i = 1; i <= 3; i++) {
	transport.emit("event", {
		type: "system",
		subtype: "compact_boundary",
		uuid: `compact-${i}`,
		session_id: "fixture-session",
		compact_metadata: { trigger: "auto", pre_tokens: 225000 },
	});
	assert.equal(transport.disposed, i === 3);
}
assert.equal(manager.isRunning(key), false);
assert.equal(manager.isBusy(key), false);
assert.equal(statuses.at(-1), "error");
assert.equal(releases, 1);
assert(
	manager
		.getBufferedEvents(key)
		.some((event) => event.type === "local_user_message"),
);
assert(
	manager
		.getBufferedEvents(key)
		.some(
			(event) =>
				event.type === "local_notice" &&
				event.fatal &&
				event.text.includes("three automatic compactions"),
		),
);
const buffered = manager.getBufferedEvents(key).length;
transport.emit("event", {
	type: "result",
	result: "late success",
	total_cost_usd: 0,
});
assert.equal(manager.getBufferedEvents(key).length, buffered);
assert.equal(statuses.at(-1), "error");
assert.deepEqual(transport.sent, ["Keep this user instruction"]);
assert.throws(() => manager.send(key, "automatic retry"), /disconnected/);
manager.restart(key, {
	cwd: "fixture-only",
	resumeSessionId: "fixture-session",
});
assert.equal(manager.isRunning(key), true);
assert(
	manager
		.getBufferedEvents(key)
		.some((event) => event.type === "local_user_message"),
);
manager.stop(key);
console.log(
	"PASS: real session manager stops the simulated compaction loop, retains history, rejects late results/retries, and permits explicit resume. No provider called.",
);
