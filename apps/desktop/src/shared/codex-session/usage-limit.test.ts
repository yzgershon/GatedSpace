import { expect, test } from "bun:test";
import { isCodexUsageLimit } from "./usage-limit";

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
