import { expect, test } from "bun:test";
import { codexQuotaReset, isCodexUsageLimit } from "./usage-limit";

test("scheduling waits for every exhausted window on the selected model", () => {
	const now = 1_800_000_000_000;
	const five = {
		usedPercent: 100,
		resetsAt: now / 1000 + 3600,
		windowDurationMins: 300,
	};
	const week = {
		usedPercent: 100,
		resetsAt: now / 1000 + 86400,
		windowDurationMins: 10080,
	};
	expect(
		codexQuotaReset(
			{ rateLimits: { primary: five, secondary: week } },
			undefined,
			now,
		),
	).toBe(now + 86_400_000);
	expect(
		codexQuotaReset(
			{ rateLimits: { primary: five, secondary: { ...week, resetsAt: null } } },
			undefined,
			now,
		),
	).toBeNull();
	expect(
		codexQuotaReset(
			{ rateLimits: { primary: { ...five, resetsAt: now / 1000 - 1 } } },
			undefined,
			now,
		),
	).toBeNull();
	expect(
		codexQuotaReset(
			{
				rateLimitsByLimitId: {
					codex: { primary: week },
					model: { normalModelSlug: "selected", primary: five },
				},
			},
			"selected",
			now,
		),
	).toBe(now + 3_600_000);
});

test("recognizes provider quota codes and older CLI usage messages", () => {
	for (const error of [
		{ codexErrorInfo: "usageLimitExceeded", message: "Request failed" },
		{ data: { code: "usage_limit_reached" } },
		new Error("You've hit your usage limit. Try again later."),
		{ message: "Account quota exhausted" },
		{ error: { code: "insufficient_quota" } },
	])
		expect(isCodexUsageLimit(error)).toBe(true);
});

test("does not mistake transient errors or token context limits for account exhaustion", () => {
	for (const error of [
		{ code: 429, message: "Rate limit exceeded, retrying" },
		{ codexErrorInfo: "contextWindowExceeded" },
		new Error("Connection closed"),
		"Model unavailable",
		"Reached the maximum context length",
		null,
	])
		expect(isCodexUsageLimit(error)).toBe(false);
});
