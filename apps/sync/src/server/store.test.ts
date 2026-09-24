import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { digest } from "@superset/shared/continuity/crypto";
import { assertLease, checkpointFingerprint } from "./store";

test("expired, superseded and foreign-device leases cannot publish", () => {
	const now = new Date(),
		token = "a".repeat(64),
		deviceId = randomUUID();
	const row = {
		id: randomUUID(),
		ownerId: "owner",
		revision: 1,
		checkpointId: null,
		deviceId,
		leaseHash: digest(token),
		leaseExpiresAt: new Date(now.getTime() + 120_000),
		fence: 2,
		createdAt: now,
		updatedAt: now,
	};
	const identity = { deviceId, leaseToken: token, fence: 2 };
	expect(() => assertLease(row, identity, now)).not.toThrow();
	for (const invalid of [
		{ ...identity, deviceId: randomUUID() },
		{ ...identity, fence: 1 },
		{ ...identity, leaseToken: "b".repeat(64) },
	])
		expect(() => assertLease(row, invalid, now)).toThrow();
	expect(() =>
		assertLease(row, identity, new Date(now.getTime() + 120_000)),
	).toThrow();
	expect(() =>
		assertLease({ ...row, leaseExpiresAt: null }, identity, now),
	).toThrow();
});
test("retry identity excludes lease renewal but includes every immutable checkpoint input", () => {
	const id = randomUUID(),
		input = {
			id: randomUUID(),
			deviceId: randomUUID(),
			baseRevision: 2,
			leaseToken: "a".repeat(64),
			fence: 1,
			manifest: {
				version: 1 as const,
				chunks: [{ id: "a".repeat(64), bytes: 35 }],
			},
		};
	const original = checkpointFingerprint(id, input);
	expect(
		checkpointFingerprint(id, {
			...input,
			leaseToken: "b".repeat(64),
			fence: 2,
		}),
	).toBe(original);
	expect(checkpointFingerprint(id, { ...input, baseRevision: 3 })).not.toBe(
		original,
	);
	expect(checkpointFingerprint(randomUUID(), input)).not.toBe(original);
	expect(
		checkpointFingerprint(id, { ...input, deviceId: randomUUID() }),
	).not.toBe(original);
});
