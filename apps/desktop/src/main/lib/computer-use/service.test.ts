import { describe, expect, test } from "bun:test";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import type { ComputerBackend } from "./backend";
import { ComputerUseService } from "./service";

const tools: Tool[] = [
	{ name: "Snapshot", inputSchema: { type: "object" } },
	{ name: "Click", inputSchema: { type: "object" } },
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

describe("desktop control grant", () => {
	test("starts off and tools cannot enable it", async () => {
		const { backend, service } = fixture();
		expect(service.get().phase).toBe("off");
		expect(() => service.discover("codex:a")).toThrow("user must enable");
		await expect(service.call("codex:a", "Click", {})).rejects.toThrow(
			"user must enable",
		);
		expect(backend.calls).toEqual([]);
	});
	test("only the enabled pane can discover and call", async () => {
		const { backend, service } = fixture();
		await service.enable("codex:a");
		expect(service.discover("codex:a")).toEqual(tools);
		expect(() => service.discover("codex:b")).toThrow();
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
		expect(() => service.discover("codex:a")).toThrow();
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
	test("connection failures and disconnects revoke access", async () => {
		const { backend, service } = fixture();
		backend.fail = "Missing dependency";
		await service.enable("codex:a");
		expect(service.get()).toEqual({
			phase: "error",
			error: "Missing dependency",
		});
		backend.fail = undefined;
		await service.enable("codex:a");
		backend.onDisconnect?.();
		await service.stop();
		expect(service.get().phase).toBe("error");
		expect(() => service.discover("codex:a")).toThrow();
	});
	test("an action timeout shuts down the controller instead of allowing late actions", async () => {
		const { backend, service } = fixture();
		await service.enable("codex:a");
		backend.fail = "Timeout";
		await expect(service.call("codex:a", "Click", {})).rejects.toThrow(
			"Timeout",
		);
		expect(backend.closed).toBe(1);
		expect(service.get().phase).toBe("error");
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
