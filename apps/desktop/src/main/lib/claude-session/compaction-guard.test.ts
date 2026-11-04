import { expect, test } from "bun:test";
import { parseStreamLine } from "shared/claude-session/events";
import { CompactionGuard } from "./compaction-guard";

function compact(id: string, trigger = "auto", parent: string | null = null) {
	const event = parseStreamLine(
		JSON.stringify({
			type: "system",
			subtype: "compact_boundary",
			uuid: id,
			session_id: "fixture",
			parent_tool_use_id: parent,
			compact_metadata: { trigger, pre_tokens: 225000 },
		}),
	);
	if (!event) throw new Error("Invalid fixture");
	return event;
}
test("stops the observed two-to-four-minute compaction cycle", () => {
	const guard = new CompactionGuard();
	expect(guard.observe(compact("first"), 0)).toBe(false);
	expect(guard.observe(compact("second"), 224000)).toBe(false);
	expect(guard.observe(compact("third"), 333000)).toBe(true);
});
test("normal spaced compactions do not trip the breaker", () => {
	const guard = new CompactionGuard();
	for (let i = 0; i < 10; i++)
		expect(guard.observe(compact(String(i)), i * 600000)).toBe(false);
});
test("manual compactions and subagents do not stop the main session", () => {
	const guard = new CompactionGuard();
	for (let i = 0; i < 5; i++) {
		expect(guard.observe(compact(String(i), "manual"), i)).toBe(false);
		expect(guard.observe(compact(String(i), "auto", "parent"), i)).toBe(false);
	}
});
test("duplicate boundaries do not count twice", () => {
	const guard = new CompactionGuard();
	for (let i = 0; i < 5; i++)
		expect(guard.observe(compact("same"), i)).toBe(false);
	expect(guard.observe(compact("second"), 6)).toBe(false);
});
test("new or incomplete CLI event shapes are ignored safely", () => {
	const guard = new CompactionGuard();
	for (const line of [
		'{"type":"system","subtype":"compact_boundary"}',
		'{"type":"system","subtype":"status","status":"compacting"}',
		'{"type":"result"}',
	]) {
		const event = parseStreamLine(line);
		if (event) expect(guard.observe(event)).toBe(false);
	}
});
