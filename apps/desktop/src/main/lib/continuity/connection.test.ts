import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ContinuityClient } from "@superset/shared/continuity/client";
import { SyncConnection } from "./connection";
import { testStorage } from "./test-storage";
import { SyncVault } from "./vault";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0))
		rmSync(dir, { recursive: true, force: true });
});
function setup() {
	const dir = mkdtempSync(join(tmpdir(), "gatedspace-connection-test-"));
	dirs.push(dir);
	const storage = testStorage();
	const vault = new SyncVault(dir, () => storage);
	const approval = Promise.withResolvers<{
		token: string;
		expiresAt: number;
	}>();
	const calls: string[] = [];
	const connection = new SyncConnection(vault, {
		start: async () => ({
			device_code: "private-code-not-for-renderer",
			user_code: "ABCD-EFGH",
			verification_uri: "https://gatedspace-sync.vercel.app/device",
			url: "https://gatedspace-sync.vercel.app/device?user_code=ABCD-EFGH",
			expires_in: 300,
			interval: 1,
		}),
		wait: async () => approval.promise,
		client: (token) =>
			new ContinuityClient(
				"https://gatedspace-sync.vercel.app",
				token,
				async (url) => {
					calls.push(String(url));
					return Response.json(
						String(url).endsWith("/me")
							? { id: "fixture-owner", email: "test@example.com" }
							: String(url).endsWith("/streams")
								? { streams: [] }
								: { ok: true },
					);
				},
			),
	});
	return { vault, approval, connection, calls };
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 20));
test("connection remains pending until approved; renderer receives no device token or recovery key", async () => {
	const { vault, approval, connection } = setup();
	await connection.begin();
	expect(connection.status().account).toBeNull();
	expect(JSON.stringify(connection.status())).not.toContain("private-code");
	approval.resolve({
		token: "fixture-secret-token",
		expiresAt: Date.now() + 60_000,
	});
	await tick();
	expect(connection.status().account?.connected).toBe(true);
	expect(connection.status().pending).toBeNull();
	await connection.setRecoveryKey();
	const key = vault.read().account?.recoveryKey;
	expect(key?.length).toBe(43);
	expect(JSON.stringify(connection.status())).not.toContain(key as string);
	expect(JSON.stringify(connection.status())).not.toContain(
		"fixture-secret-token",
	);
	await expect(connection.setRecoveryKey()).rejects.toThrow("already stored");
});
test("a late approval cannot reconnect a cancelled request", async () => {
	const { connection, approval, calls } = setup();
	await connection.begin();
	connection.cancel();
	approval.resolve({
		token: "fixture-secret-token",
		expiresAt: Date.now() + 60_000,
	});
	await tick();
	expect(connection.status().account).toBeNull();
	expect(calls).toHaveLength(0);
});
test("racing recovery-key requests cannot overwrite the first saved key", async () => {
	const { connection, approval } = setup();
	await connection.begin();
	approval.resolve({
		token: "fixture-secret-token",
		expiresAt: Date.now() + 60_000,
	});
	await tick();
	const results = await Promise.allSettled([
		connection.setRecoveryKey(),
		connection.setRecoveryKey(),
	]);
	expect(
		results.filter((result) => result.status === "fulfilled"),
	).toHaveLength(1);
});
