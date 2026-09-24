import { afterEach, expect, mock, test } from "bun:test";
import { timingSafeEqual } from "node:crypto";
import express from "express";

let failToken = false;
let serveCalls = 0,
	stopCalls = 0;
let resolveServe: ((result: { url: string }) => void) | undefined;
mock.module("./token", () => ({
	loadOrCreateBridgeToken: () => {
		if (failToken) throw new Error("locked");
		return "fixture-secret";
	},
	rotateBridgeToken: () => {},
	tokensMatch: (a: string, b?: string) =>
		!!b &&
		a.length === b.length &&
		timingSafeEqual(Buffer.from(a), Buffer.from(b)),
}));
mock.module("./bridge-state", () => ({
	readBridgeState: () => ({ enabled: true, mode: "tailscale-serve" }),
}));
mock.module("./tailscale-serve", () => ({
	startTailscaleServe: () => {
		serveCalls++;
		return new Promise<{ url: string }>((resolve) => {
			resolveServe = resolve;
		});
	},
	stopTailscaleServe: async () => {
		stopCalls++;
	},
	stopTailscaleServeSync: () => {
		stopCalls++;
	},
}));
mock.module("../claude-profile", () => ({
	getClaudeProfile: () => ({ profiles: [] }),
	setClaudeProfileMode: () => {},
}));
mock.module("../claude-session/session-manager", () => ({
	claudeSessionManager: { listSessions: () => [] },
}));
mock.module("../claude-session/transcript", () => ({
	loadSessionTranscript: () => [],
}));
mock.module("../claude-session/usage-refresh", () => ({
	readProfileLimits: () => [],
}));
mock.module("../claude-sessions/claude-sessions", () => ({
	listClaudeSessions: () => [],
}));
mock.module("./push", () => ({ pushService: {} }));
mock.module("./workspace-targets", () => ({
	listBridgeWorkspaceTargets: () => [],
}));
mock.module("./session-api", () => ({
	mobileSessionRouter: () =>
		express
			.Router()
			.get("/sessions", (_req, res) => res.json({ sessions: [] })),
}));
const { MobileBridge } = await import("./server");
let bridge: InstanceType<typeof MobileBridge> | undefined;
afterEach(() => {
	bridge?.stopSync();
	failToken = false;
	resolveServe = undefined;
});
async function waitForServe() {
	for (let i = 0; i < 100 && !resolveServe; i++) await Bun.sleep(5);
	expect(resolveServe).toBeDefined();
}

test("restore recovers from thrown startup errors without losing pairing", async () => {
	bridge = new MobileBridge();
	failToken = true;
	expect(await bridge.restore()).toMatchObject({
		running: false,
		error: expect.stringContaining("Retrying"),
	});
	failToken = false;
	const retry = bridge.restore();
	await waitForServe();
	resolveServe?.({ url: "https://test.example" });
	expect(await retry).toMatchObject({
		running: true,
		secure: true,
		url: "https://test.example/?t=fixture-secret",
	});
});
test("simultaneous starts share a listener and never advertise HTTP during HTTPS setup", async () => {
	bridge = new MobileBridge();
	const before = serveCalls;
	const one = bridge.start("tailscale-serve"),
		two = bridge.start("tailscale-serve");
	await waitForServe();
	expect(bridge.status()).toMatchObject({ running: false });
	expect(bridge.status().url).toBeUndefined();
	resolveServe?.({ url: "https://test.example" });
	expect(await one).toEqual(await two);
	expect(serveCalls - before).toBe(1);
	const port = bridge.status().port;
	expect(
		(await fetch(`http://127.0.0.1:${port}/api/mobile/sessions`)).status,
	).toBe(401);
	expect(
		(
			await fetch(`http://127.0.0.1:${port}/api/mobile/sessions`, {
				headers: { "x-bridge-token": "fixture-secret" },
			})
		).status,
	).toBe(200);
});
test("stop while Tailscale starts cannot resurrect the bridge", async () => {
	bridge = new MobileBridge();
	const before = stopCalls;
	const started = bridge.start("tailscale-serve");
	await waitForServe();
	const stopped = bridge.stop();
	resolveServe?.({ url: "https://test.example" });
	expect((await started).running).toBe(false);
	expect((await stopped).running).toBe(false);
	expect(stopCalls - before).toBe(1);
});
