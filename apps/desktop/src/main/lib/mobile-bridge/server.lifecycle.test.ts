import { afterEach, expect, mock, test } from "bun:test";
import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import express from "express";
import gatedSpaceIconPath from "../../../resources/build/icons/icon.png?asset";
import { promptSchema } from "./session-contract";

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
			.get("/sessions", (_req, res) => res.json({ sessions: [] }))
			.post("/codex/fixture/send", (req, res) => {
				const body = promptSchema.parse(req.body);
				res.json({
					images: body.images.length,
					bytes: Buffer.from(body.images[0].data, "base64").length,
				});
			}),
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

test("mobile installation serves the desktop logo without a pairing token", async () => {
	bridge = new MobileBridge();
	await bridge.start("loopback");
	const base = `http://127.0.0.1:${bridge.status().port}`;
	const manifest = await fetch(`${base}/manifest.webmanifest`).then((r) =>
		r.json(),
	);
	const icon = manifest.icons[0];
	const response = await fetch(new URL(icon.src, base));
	expect(response.status).toBe(200);
	expect(response.headers.get("content-type")).toContain("image/png");
	expect(response.headers.get("cache-control")).toContain("no-store");
	const image = Buffer.from(await response.arrayBuffer());
	expect(image.equals(await readFile(gatedSpaceIconPath))).toBe(true);
	expect(icon.sizes).toBe(
		`${image.readUInt32BE(16)}x${image.readUInt32BE(20)}`,
	);
	const html = await fetch(base).then((r) => r.text());
	expect(html).not.toContain("__PAGE_VERSION__");
	expect(html).toContain(
		`rel="apple-touch-icon" sizes="${icon.sizes}" href="${icon.src}"`,
	);
	expect(html).toContain(
		`rel="icon" type="image/png" sizes="${icon.sizes}" href="${icon.src}"`,
	);
	const legacy = await fetch(`${base}/icon.svg`, { redirect: "manual" });
	expect(legacy.headers.get("location")).toBe(icon.src);
});
test("paired phones can upload a five-megabyte photo through the real bridge body parser", async () => {
	bridge = new MobileBridge();
	await bridge.start("loopback");
	const response = await fetch(
		`http://127.0.0.1:${bridge.status().port}/api/mobile/codex/fixture/send`,
		{
			method: "POST",
			headers: {
				"x-bridge-token": "fixture-secret",
				"content-type": "application/json",
			},
			body: JSON.stringify({
				requestId: crypto.randomUUID(),
				images: [
					{
						name: "camera.png",
						mediaType: "image/png",
						data: Buffer.alloc(5 * 1024 * 1024, 1).toString("base64"),
					},
				],
			}),
		},
	);
	expect(response.status).toBe(200);
	expect(await response.json()).toEqual({ images: 1, bytes: 5 * 1024 * 1024 });
});
