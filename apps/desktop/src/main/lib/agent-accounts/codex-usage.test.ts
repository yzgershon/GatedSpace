import { expect, test } from "bun:test";
import { normalizeCodexLimits } from "../../../shared/codex-session/controls";
import { CodexAccountUsage } from "./codex-usage";

const limits = (percent: number) =>
	normalizeCodexLimits({
		rateLimits: {
			primary: { usedPercent: percent, windowDurationMins: 10080 },
		},
	});

test("keeps account and model limits separate and coalesces repeated reads", async () => {
	const calls: string[] = [];
	const usage = new CodexAccountUsage(async (id, model) => {
		calls.push(`${id}:${model}`);
		return limits(id === "personal" ? (model ? 18 : 8) : 93);
	});
	const [personal, work, repeated, special] = await Promise.all([
		usage.get("personal"),
		usage.get("work"),
		usage.get("personal"),
		usage.get("personal", "special"),
	]);
	expect(personal.limits?.weeklyPercent).toBe(8);
	expect(repeated).toEqual(personal);
	expect(work.limits?.weeklyPercent).toBe(93);
	expect(special.limits?.weeklyPercent).toBe(18);
	expect(calls).toHaveLength(3);
	await usage.get("work");
	expect(calls).toHaveLength(3);
});

test("failed refresh preserves that account's timestamp and last reading without inventing zero", async () => {
	let now = 1_000;
	let fail = false;
	const usage = new CodexAccountUsage(
		async (id) => {
			if (fail || id === "offline")
				throw new Error("private provider diagnostics");
			return limits(67);
		},
		() => now,
	);
	const first = await usage.get("work");
	fail = true;
	now += 31_000;
	const stale = await usage.get("work");
	expect(stale.limits).toEqual(first.limits);
	expect(stale.updatedAt).toBe(first.updatedAt);
	expect(stale.error).toContain("Usage unavailable");
	expect(JSON.stringify(stale)).not.toContain("private");
	const offline = await usage.get("offline");
	expect(offline.limits).toBeNull();
	expect(offline.updatedAt).toBeNull();
});

test("explicit refresh bypasses a recent snapshot but coalesces overlapping retries", async () => {
	let reads = 0;
	const usage = new CodexAccountUsage(async () => limits(++reads * 10));
	expect((await usage.get("work")).limits?.weeklyPercent).toBe(10);
	const [first, second] = await Promise.all([
		usage.get("work", undefined, true),
		usage.get("work", undefined, true),
	]);
	expect(reads).toBe(2);
	expect(first.limits?.weeklyPercent).toBe(20);
	expect(second).toEqual(first);
});
