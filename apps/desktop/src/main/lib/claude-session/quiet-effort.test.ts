import { expect, test } from "bun:test";
import type { ClaudeStreamEvent } from "../../../shared/claude-session/events";
import { QuietEffortUpdates } from "./quiet-effort";

const result = (text = "Set effort level to xhigh", changes = {}) =>
	({
		type: "result",
		subtype: "success",
		is_error: false,
		num_turns: 0,
		result: text,
		...changes,
	}) as ClaudeStreamEvent;
test("automatic effort acknowledgements are quiet; deliberate commands are not", () => {
	const updates = new QuietEffortUpdates();
	expect(updates.consume(result())).toBe(false);
	expect(updates.track("xhigh")).toBe(true);
	expect(updates.track("xhigh")).toBe(false);
	expect(updates.consume(result())).toBe(true);
	expect(updates.consume(result())).toBe(false);
});
test("real replies, errors, different settings and subagents are never swallowed", () => {
	const updates = new QuietEffortUpdates();
	updates.track("xhigh");
	for (const event of [
		result("Set effort level to high"),
		result("The command says: Set effort level to xhigh"),
		result(undefined, { num_turns: 1 }),
		result(undefined, { is_error: true }),
		result(undefined, { parent_tool_use_id: "child" }),
	])
		expect(updates.consume(event)).toBe(false);
	expect(updates.consume(result())).toBe(true);
});
test("synthetic acknowledgement and result are both quiet without capturing streaming", () => {
	const updates = new QuietEffortUpdates();
	updates.track("xhigh");
	const event = {
		type: "assistant",
		message: {
			model: "<synthetic>",
			content: [{ type: "text", text: "Set effort level to xhigh" }],
		},
	} as Extract<ClaudeStreamEvent, { type: "assistant" }>;
	expect(updates.consume(event)).toBe(true);
	expect(updates.consume({ type: "stream_event" } as ClaudeStreamEvent)).toBe(
		false,
	);
	expect(
		updates.consume({
			...event,
			message: { ...event.message, model: "claude" },
		} as ClaudeStreamEvent),
	).toBe(false);
	expect(updates.consume(result())).toBe(true);
});
test("failed writes can retry and a new process reapplies its preference", () => {
	const updates = new QuietEffortUpdates();
	updates.track("xhigh");
	updates.failed("xhigh");
	expect(updates.track("xhigh")).toBe(true);
	expect(new QuietEffortUpdates().track("xhigh")).toBe(true);
});
