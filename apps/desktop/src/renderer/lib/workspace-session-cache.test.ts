import { describe, expect, test } from "bun:test";
import type { SessionData } from "./auth-client";
import {
	createWorkspaceSessionCache,
	isWorkspaceSessionCacheEnabled,
} from "./workspace-session-cache";

function fixture(token = "test-session-a", userId = "user-a"): SessionData {
	const now = new Date("2026-11-25T12:00:00Z");
	return {
		user: {
			id: userId,
			name: "Saved user",
			email: "saved@example.test",
			emailVerified: true,
			image: `data:image/png;base64,${"A".repeat(310_000)}`,
			createdAt: now,
			updatedAt: now,
			onboardedAt: now,
		},
		session: {
			id: "session-a",
			token,
			userId,
			createdAt: now,
			updatedAt: now,
			expiresAt: new Date("2026-12-25T12:00:00Z"),
			activeOrganizationId: "existing-workspace-org",
			organizationIds: ["existing-workspace-org"],
			role: "owner",
			plan: "pro",
			ipAddress: "192.0.2.1",
			userAgent: "test-only-agent",
		},
	} as SessionData;
}

function memoryStorage() {
	const rows = new Map<string, string>();
	return {
		rows,
		getItem: (key: string) => rows.get(key) ?? null,
		setItem: (key: string, value: string) => {
			rows.set(key, value);
		},
		removeItem: (key: string) => {
			rows.delete(key);
		},
	};
}

const api = "http://localhost:3001";

describe("local workspace restoration", () => {
	test("cold launch restores the same user and organization without credentials or large avatars", async () => {
		const storage = memoryStorage();
		const first = createWorkspaceSessionCache(api, () => storage);
		await first.setCredential("test-session-a");
		await first.remember(fixture());
		const encoded = [...storage.rows.values()][0];
		expect(encoded.length).toBeLessThan(2_000);
		for (const excluded of [
			"test-session-a",
			"data:image",
			"192.0.2.1",
			"test-only-agent",
		]) {
			expect(encoded).not.toContain(excluded);
		}
		const restarted = createWorkspaceSessionCache(api, () => storage);
		await restarted.setCredential("test-session-a");
		expect(restarted.getSnapshot()?.user.id).toBe("user-a");
		expect(restarted.getSnapshot()?.session.activeOrganizationId).toBe(
			"existing-workspace-org",
		);
		expect(restarted.getSnapshot()?.user.onboardedAt).toBeInstanceOf(Date);
		expect(restarted.getSnapshot()?.session.token).toBe("");
	});

	test("many session hook subscribers do not cause duplicate writes or render loops", async () => {
		const storage = memoryStorage();
		const cache = createWorkspaceSessionCache(api, () => storage);
		await cache.setCredential("test-session-a");
		let notifications = 0;
		cache.subscribe(() => notifications++);
		await Promise.all(
			Array.from({ length: 50 }, () => cache.remember(fixture())),
		);
		expect(notifications).toBe(1);
		const snapshot = cache.getSnapshot();
		await cache.setCredential("test-session-a");
		await cache.remember(fixture());
		expect(cache.getSnapshot()).toBe(snapshot);
		expect(notifications).toBe(1);
	});

	test("a different account cannot restore or save the previous account's identity", async () => {
		const storage = memoryStorage();
		const cache = createWorkspaceSessionCache(api, () => storage);
		await cache.setCredential("test-session-a");
		await cache.remember(fixture());
		await cache.setCredential("test-session-b");
		expect(cache.getSnapshot()).toBeNull();
		await cache.remember(fixture());
		expect(cache.getSnapshot()).toBeNull();
		await cache.remember(fixture("test-session-b", "user-b"));
		expect(cache.getSnapshot()?.user.id).toBe("user-b");
		const restarted = createWorkspaceSessionCache(api, () => storage);
		await restarted.setCredential("test-session-a");
		expect(restarted.getSnapshot()).toBeNull();
	});

	test("logout wins over pending restore and save operations", async () => {
		const storage = memoryStorage();
		const cache = createWorkspaceSessionCache(api, () => storage);
		await cache.setCredential("test-session-a");
		await cache.remember(fixture());
		const restarted = createWorkspaceSessionCache(api, () => storage);
		const restoring = restarted.setCredential("test-session-a");
		const saving = restarted.remember(fixture());
		await restarted.setCredential(null);
		await Promise.all([restoring, saving]);
		expect(restarted.getSnapshot()).toBeNull();
		expect(storage.rows.size).toBe(0);
	});

	test("invalid, oversized and mismatched organization records fail safely", async () => {
		const storage = memoryStorage();
		const first = createWorkspaceSessionCache(api, () => storage);
		await first.setCredential("test-session-a");
		await first.remember(fixture());
		const [key, raw] = [...storage.rows.entries()][0];
		const badMembership = JSON.parse(raw);
		badMembership.data.session.organizationIds = ["different-org"];
		const badUser = JSON.parse(raw);
		badUser.data.session.userId = "different-user";
		for (const bad of [
			"{",
			"x".repeat(16_385),
			JSON.stringify(badMembership),
			JSON.stringify(badUser),
		]) {
			storage.setItem(key, bad);
			const cache = createWorkspaceSessionCache(api, () => storage);
			await cache.setCredential("test-session-a");
			expect(cache.getSnapshot()).toBeNull();
		}
	});

	test("unavailable browser storage still permits an in-memory fallback", async () => {
		const cache = createWorkspaceSessionCache(api, () => {
			throw new Error("Storage unavailable");
		});
		await cache.setCredential("test-session-a");
		await cache.remember(fixture());
		expect(cache.getSnapshot()?.user.id).toBe("user-a");
		await cache.setCredential(null);
		expect(cache.getSnapshot()).toBeNull();
	});

	test("fallback is scoped to the local backend and never enabled for hosted authentication", async () => {
		for (const url of [
			"https://app.example.test",
			"http://localhost.attacker.test",
			"http://example.test@localhost:3001",
			"not-a-url",
		]) {
			expect(isWorkspaceSessionCacheEnabled(url)).toBe(false);
			const cache = createWorkspaceSessionCache(url, () => {
				throw new Error("Must not read storage");
			});
			await cache.setCredential("test-session-a");
			await cache.remember(fixture());
			expect(cache.getSnapshot()).toBeNull();
		}
		expect(isWorkspaceSessionCacheEnabled("http://127.0.0.1:3001")).toBe(true);
	});
});
