import { describe, expect, it } from "bun:test";
import type { ClaudeStreamEvent } from "./events";
import { buildTimeline, turnTokenTotal } from "./timeline";

/**
 * The counter beside the working indicator. It is watched while waiting, so
 * every way of getting it wrong is visible: a number that double-counts, one
 * that keeps climbing across turns, or one that leaps when a subagent starts.
 */

function prompt(text: string): ClaudeStreamEvent {
	return { type: "local_user_message", id: `u-${text}`, text } as never;
}

function messageStart(parent: string | null = null): ClaudeStreamEvent {
	return {
		type: "stream_event",
		parent_tool_use_id: parent,
		event: { type: "message_start", message: { usage: {} } },
	} as never;
}

/**
 * The top-level event that closes an assistant message. This is what banks the
 * count, because it is the only one of the two that survives main's replay
 * buffer.
 */
function assistantDone(
	outputTokens: number,
	parent: string | null = null,
): ClaudeStreamEvent {
	return {
		type: "assistant",
		parent_tool_use_id: parent,
		message: {
			id: `m-${outputTokens}-${parent ?? "main"}`,
			content: [],
			usage: { output_tokens: outputTokens },
		},
	} as never;
}

function messageDelta(
	outputTokens: number,
	parent: string | null = null,
): ClaudeStreamEvent {
	return {
		type: "stream_event",
		parent_tool_use_id: parent,
		event: {
			type: "message_delta",
			delta: {},
			usage: { output_tokens: outputTokens },
		},
	} as never;
}

function total(events: ClaudeStreamEvent[]): number {
	return turnTokenTotal(buildTimeline(events).turnTokens);
}

describe("the live token counter", () => {
	it("is nothing before anything has been written", () => {
		expect(total([prompt("go")])).toBe(0);
	});

	it("follows the running count of the message being written", () => {
		expect(total([prompt("go"), messageStart(), messageDelta(120)])).toBe(120);
	});

	it("replaces rather than adds, because the API count is cumulative", () => {
		// Adding each report would read 60 then 180 then 420 for a message that
		// actually produced 300.
		const events = [
			prompt("go"),
			messageStart(),
			messageDelta(60),
			messageDelta(180),
			messageDelta(300),
		];
		expect(total(events)).toBe(300);
	});

	it("carries across the message boundary a tool call creates", () => {
		// One turn, two assistant messages: the second starts counting from zero
		// again, so the first has to be banked or the total collapses.
		const events = [
			prompt("go"),
			messageStart(),
			messageDelta(300),
			assistantDone(300),
			messageStart(),
			messageDelta(50),
		];
		expect(total(events)).toBe(350);
	});

	it("does not double-count a message that streamed and then finished", () => {
		// The delta count and the final usage describe the SAME tokens.
		const events = [
			prompt("go"),
			messageStart(),
			messageDelta(300),
			assistantDone(300),
		];
		expect(total(events)).toBe(300);
	});

	it("counts without any stream events at all", () => {
		// Main's replay buffer drops SSE frames, so a pane rebuilt from it sees
		// only the assistant events. It must still show a number.
		expect(total([prompt("go"), assistantDone(120), assistantDone(80)])).toBe(
			200,
		);
	});

	it("starts again at the next prompt", () => {
		const events = [
			prompt("first"),
			messageStart(),
			messageDelta(500),
			assistantDone(500),
			prompt("second"),
			messageStart(),
			messageDelta(20),
		];
		expect(total(events)).toBe(20);
	});

	it("ignores a subagent's output", () => {
		// A Task's tokens are real work but they are not this turn's reply, and
		// counting them made the number jump by thousands the moment one began.
		const events = [
			prompt("go"),
			messageStart(),
			messageDelta(100),
			messageStart("tool-1"),
			messageDelta(9000, "tool-1"),
			assistantDone(9000, "tool-1"),
		];
		expect(total(events)).toBe(100);
	});

	it("survives a delta with no usage on it", () => {
		const noUsage = {
			type: "stream_event",
			parent_tool_use_id: null,
			event: { type: "message_delta", delta: { stop_reason: "end_turn" } },
		} as never;
		expect(
			total([prompt("go"), messageStart(), messageDelta(75), noUsage]),
		).toBe(75);
	});
});
