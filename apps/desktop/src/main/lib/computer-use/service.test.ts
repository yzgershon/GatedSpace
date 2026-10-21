import { describe, expect, test } from "bun:test";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import type { ComputerBackend } from "./backend";
import { ComputerUseService } from "./service";

const tools: Tool[] = [
	{ name: "Snapshot", inputSchema: { type: "object" } },
	{ name: "Click", inputSchema: { type: "object" } },
	{ name: "Screenshot", inputSchema: { type: "object" } },
];
class FakeBackend implements ComputerBackend {
	closed = 0;
	calls: string[] = [];
	startGate?: Promise<void>;
	callGate?: Promise<void>;
	closeGate?: Promise<void>;
	fail?: string;
	signal?: AbortSignal;
	onDisconnect?: () => void;
	async start(signal: AbortSignal) {
		this.signal = signal;
		await this.startGate;
		if (this.fail) throw new Error(this.fail);
		return tools;
	}
	async call(name: string): Promise<CallToolResult> {
		this.calls.push(name);
		await this.callGate;
		if (this.fail) throw new Error(this.fail);
		return {
			content: [{ type: "image", data: "fixture", mimeType: "image/png" }],
		};
	}
	async close() {
		this.closed++;
		await this.closeGate;
	}
}
function fixture() {
	const backend = new FakeBackend();
	return { backend, service: new ComputerUseService(() => backend) };
}
function gate() {
	let release = () => {};
	const promise = new Promise<void>((resolve) => {
		release = resolve;
	});
	return { promise, release };
}

test("Stop during idle shutdown cancels a pending automatic resume", async () => {
	const { backend, service } = fixture();
	await service.enable("codex:a");
	const closing = gate();
	backend.closeGate = closing.promise;
	const paused = service.pause("codex:a");
	const resume = service.call("codex:a", "Click", {});
	const stopped = service.stop();
	closing.release();
	await Promise.all([paused, stopped]);
	await expect(resume).rejects.toThrow("user must enable");
	expect(service.get().phase).toBe("off");
	expect(backend.calls).toEqual([]);
});

test("concurrent resumes share one connection and never overlap desktop actions", async () => {
	const first = new FakeBackend();
	const second = new FakeBackend();
	const connecting = gate();
	const acting = gate();
	second.startGate = connecting.promise;
	second.callGate = acting.promise;
	let created = 0;
	const service = new ComputerUseService(() =>
		++created === 1 ? first : second,
	);
	await service.enable("codex:a");
	await service.pause("codex:a");
	await expect(service.discover("codex:b")).rejects.toThrow();
	const call = service.call("codex:a", "Click", {});
	const duplicate = service.call("codex:a", "Screenshot", {});
	connecting.release();
	await expect(duplicate).rejects.toThrow("still running");
	expect(created).toBe(2);
	// A late callback from the previous process cannot stop the new controller.
	first.onDisconnect?.();
	expect(service.get().phase).toBe("ready");
	acting.release();
	await call;
	await service.stop();
});

test("reconnection never replays a timed-out action", async () => {
	const first = new FakeBackend();
	const second = new FakeBackend();
	let created = 0;
	const service = new ComputerUseService(() =>
		++created === 1 ? first : second,
	);
	await service.enable("codex:a");
	first.fail = "Timeout";
	await expect(service.call("codex:a", "Click", {})).rejects.toThrow("Timeout");
	expect(first.calls).toEqual(["Click"]);
	expect(first.signal?.aborted).toBe(true);
	await service.call("codex:a", "Screenshot", {});
	expect(second.calls).toEqual(["Screenshot"]);
	await service.stop();
});

test("a cancelled startup cannot block a newly approved controller", async () => {
	const first = new FakeBackend();
	const second = new FakeBackend();
	const connecting = gate();
	first.startGate = connecting.promise;
	let created = 0;
	const service = new ComputerUseService(() =>
		++created === 1 ? first : second,
	);
	const old = service.enable("codex:a");
	await service.stop();
	await service.enable("codex:b");
	connecting.release();
	await old;
	expect(service.get()).toEqual({ phase: "ready", owner: "codex:b" });
	await expect(service.discover("codex:a")).rejects.toThrow();
	await service.call("codex:b", "Screenshot", {});
	expect(second.calls).toEqual(["Screenshot"]);
	await service.stop();
});

test("discovery retries a failed initial connection within the existing approval", async () => {
	const { service, backend } = fixture();
	backend.fail = "Temporary connection failure";
	await service.enable("codex:a");
	backend.fail = undefined;
	expect(await service.discover("codex:a")).toEqual(tools);
	expect(service.get().phase).toBe("ready");
	await service.stop();
});

describe("desktop control grant", () => {
	test("starts off and tools cannot enable it", async () => {
		const { backend, service } = fixture();
		expect(service.get().phase).toBe("off");
		await expect(service.discover("codex:a")).rejects.toThrow(
			"user must enable",
		);
		await expect(service.call("codex:a", "Click", {})).rejects.toThrow(
			"user must enable",
		);
		expect(backend.calls).toEqual([]);
	});
	test("only the enabled pane can discover and call", async () => {
		const { backend, service } = fixture();
		await service.enable("codex:a");
		expect(await service.discover("codex:a")).toEqual(tools);
		await expect(service.discover("codex:b")).rejects.toThrow();
		await expect(service.enable("codex:b")).rejects.toThrow("Another pane");
		await expect(service.call("codex:b", "Click", {})).rejects.toThrow();
		expect(backend.calls).toEqual([]);
	});
	test("unknown and non-UI tools never reach Windows", async () => {
		const { backend, service } = fixture();
		await service.enable("codex:a");
		await expect(service.call("codex:a", "PowerShell", {})).rejects.toThrow(
			"not enabled",
		);
		expect(backend.calls).toEqual([]);
	});
	test("screenshots retain the image content type", async () => {
		const { service } = fixture();
		await service.enable("codex:a");
		const result = await service.call("codex:a", "Snapshot", {});
		expect(result.content[0].type).toBe("image");
		expect(service.get()).toEqual({ phase: "ready", owner: "codex:a" });
	});
	test("serializes desktop actions and publishes activity without arguments", async () => {
		const { backend, service } = fixture();
		await service.enable("codex:a");
		const pending = gate();
		backend.callGate = pending.promise;
		const call = service.call("codex:a", "Click", {
			privateText: "never published",
		});
		expect(service.get()).toEqual({
			phase: "ready",
			owner: "codex:a",
			activity: "Click",
		});
		await expect(service.call("codex:a", "Snapshot", {})).rejects.toThrow(
			"still running",
		);
		pending.release();
		await call;
	});
	test("Stop immediately revokes the grant and aborts a running action", async () => {
		const { backend, service } = fixture();
		await service.enable("codex:a");
		const pending = gate();
		backend.callGate = pending.promise;
		const call = service.call("codex:a", "Click", {});
		await service.stop();
		expect(backend.signal?.aborted).toBe(true);
		expect(service.get().phase).toBe("off");
		await expect(service.discover("codex:a")).rejects.toThrow();
		pending.release();
		await expect(call).rejects.toThrow("stopped");
		expect(service.get().phase).toBe("off");
	});
	test("Stop during setup cannot grant access when startup eventually resolves", async () => {
		const { backend, service } = fixture();
		const pending = gate();
		backend.startGate = pending.promise;
		const enabling = service.enable("codex:a");
		expect(service.get().phase).toBe("connecting");
		await service.stop();
		pending.release();
		await enabling;
		expect(service.get().phase).toBe("off");
	});
	test("cannot start a new controller until the old one is closed", async () => {
		const { backend, service } = fixture();
		await service.enable("codex:a");
		const pending = gate();
		backend.closeGate = pending.promise;
		const stopping = service.stop();
		await expect(service.enable("codex:b")).rejects.toThrow("still stopping");
		pending.release();
		await stopping;
	});
	test("connection failures and disconnects pause without losing approval", async () => {
		const { backend, service } = fixture();
		backend.fail = "Missing dependency";
		await service.enable("codex:a");
		expect(service.get()).toEqual({
			phase: "paused",
			owner: "codex:a",
			error: "Missing dependency",
		});
		backend.fail = undefined;
		await service.enable("codex:a");
		backend.onDisconnect?.();
		await service.pause("codex:a");
		expect(service.get().phase).toBe("paused");
		expect(await service.discover("codex:a")).toEqual(tools);
		await service.stop();
	});
	test("an action timeout shuts down the controller instead of allowing late actions", async () => {
		const { backend, service } = fixture();
		await service.enable("codex:a");
		backend.fail = "Timeout";
		await expect(service.call("codex:a", "Click", {})).rejects.toThrow(
			"Timeout",
		);
		expect(backend.closed).toBe(1);
		expect(service.get().phase).toBe("paused");
	});
	test("closing another pane preserves control; closing the owner stops it", async () => {
		const { service } = fixture();
		await service.enable("codex:a");
		service.release("codex:b");
		expect(service.get().phase).toBe("ready");
		service.release("codex:a");
		await service.stop();
		expect(service.get().phase).toBe("off");
	});
});

test("enable requests never grant access and can be dismissed", async () => {
	const { service, backend } = fixture();
	service.request("codex:a", "Open the release folder");
	expect(service.get().phase).toBe("off");
	expect(service.get().request?.owner).toBe("codex:a");
	await expect(service.discover("codex:a")).rejects.toThrow();
	expect(backend.signal).toBeUndefined();
	service.dismissRequest("codex:b");
	expect(service.get().request).toBeDefined();
	service.dismissRequest("codex:a");
	expect(service.get()).toEqual({ phase: "off" });
});
test("a single action returns its fresh screenshot without another agent round trip", async () => {
	const { service, backend } = fixture();
	await service.enable("codex:a");
	const result = await service.call("codex:a", "Click", {}, true);
	expect(backend.calls).toEqual(["Click", "Screenshot"]);
	expect(result.content.filter((c) => c.type === "image")).toHaveLength(2);
	backend.calls = [];
	await service.call("codex:a", "Screenshot", {}, true);
	expect(backend.calls).toEqual(["Screenshot"]);
	await service.stop();
});
test("idle control shuts down but never expires during an action", async () => {
	const backend = new FakeBackend();
	const service = new ComputerUseService(() => backend, 30);
	await service.enable("codex:a");
	const pending = gate();
	backend.callGate = pending.promise;
	const action = service.call("codex:a", "Click", {}, true);
	await new Promise((r) => setTimeout(r, 60));
	expect(service.get().phase).toBe("ready");
	expect(backend.closed).toBe(0);
	pending.release();
	await action;
	await new Promise((r) => setTimeout(r, 60));
	expect(service.get().phase).toBe("paused");
	expect(backend.closed).toBe(1);
	expect(await service.discover("codex:a")).toEqual(tools);
	await service.call("codex:a", "Screenshot", {});
	expect(service.get().phase).toBe("ready");
	await service.stop();
});
