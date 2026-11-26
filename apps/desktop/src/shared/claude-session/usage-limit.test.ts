import { expect, test } from "bun:test";
import type { ClaudeStreamEvent } from "./events";
import { applyEvent, emptyTimeline } from "./timeline";
import { claudeUsageLimit } from "./usage-limit";

const event = (value: unknown) => value as ClaudeStreamEvent;
test("Claude distinguishes rejected quota from allowed and overage warnings", () => {
	for (const status of ["allowed", "allowed_warning"])
		expect(
			claudeUsageLimit(
				event({
					type: "rate_limit_event",
					rate_limit_info: { status, overageStatus: "rejected" },
				}),
			),
		).toBeNull();
	expect(
		claudeUsageLimit(
			event({
				type: "rate_limit_event",
				rate_limit_info: { status: "rejected", resetsAt: 1_800_000_000 },
			}),
		),
	).toEqual({
		message: "Claude's account usage limit was reached.",
		resetAt: 1_800_000_000_000,
	});
});
test("quota error messages are detected but ordinary agent text is not", () => {
	const message = {
		content: [
			{
				type: "text",
				text: "You've hit your limit · resets 11pm (America/New_York)",
			},
		],
	};
	expect(
		claudeUsageLimit(
			event({ type: "assistant", error: "rate_limit", message }),
		),
	).not.toBeNull();
	expect(claudeUsageLimit(event({ type: "assistant", message }))).toBeNull();
	expect(
		claudeUsageLimit(
			event({
				type: "result",
				is_error: true,
				errors: ["You've hit your 5-hour limit"],
			}),
		),
	).not.toBeNull();
	expect(
		claudeUsageLimit(
			event({
				type: "result",
				is_error: true,
				result: "Reached maximum context length",
			}),
		),
	).toBeNull();
	expect(
		claudeUsageLimit(
			event({
				type: "assistant",
				error: "rate_limit",
				message,
				parent_tool_use_id: "child",
			}),
		),
	).toBeNull();
});
test("quota state replays and stays failed after a nominal success result", () => {
	const recovery = {
		id: "quota",
		message: "Quota reached",
		resetAt: null,
		autoContinue: true,
		continuing: false,
	};
	let timeline = applyEvent(emptyTimeline(), {
		type: "local_usage_recovery",
		recovery,
	});
	timeline = applyEvent(
		timeline,
		event({
			type: "result",
			is_error: false,
			result: "Limit reached",
			modelUsage: {},
			uuid: "r",
		}),
	);
	expect(timeline.status).toBe("error");
	expect(timeline.usageRecovery).toEqual(recovery);
	timeline = applyEvent(timeline, {
		type: "local_usage_recovery",
		recovery: null,
	});
	expect(timeline.usageRecovery).toBeNull();
});
