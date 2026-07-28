import { describe, expect, it, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type ClaudeStreamEvent, parseStreamLine } from "./events";
import {
	applyEvent,
	buildTimeline,
	emptyTimeline,
	groupSubagents,
	readAssistantContext,
	settled,
	type ToolItem,
	withUserMessage,
} from "./timeline";

const PLANS_DIR = join(import.meta.dir, "../../../plans");
const TOOLS_SAMPLE = "20260724-claude-code-stream-tools-sample.jsonl";

function loadEvents(file: string): ClaudeStreamEvent[] {
	return readFileSync(join(PLANS_DIR, file), "utf-8")
		.split("\n")
		.map(parseStreamLine)
		.filter((e): e is ClaudeStreamEvent => e !== null);
}

describe("buildTimeline over the real tool transcript", () => {
	const timeline = buildTimeline(loadEvents(TOOLS_SAMPLE));

	it("captures the session header from system/init", () => {
		expect(timeline.header).toBeDefined();
		expect(timeline.header?.model).toContain("claude");
		expect(timeline.header?.slashCommands.length).toBeGreaterThan(0);
		expect(Array.isArray(timeline.header?.mcpServers)).toBe(true);
	});

	it("ends in a terminal status with a result item", () => {
		expect(timeline.status).toBe("done");
		const result = timeline.items.find((i) => i.kind === "result");
		expect(result).toBeDefined();
		if (result?.kind === "result") {
			expect(typeof result.costUsd).toBe("number");
			expect(result.isError).toBe(false);
		}
	});

	it("renders thinking, a tool call, and assistant text", () => {
		const kinds = timeline.items.map((i) => i.kind);
		expect(kinds).toContain("thinking");
		expect(kinds).toContain("tool");
		expect(kinds).toContain("text");
	});

	it("pairs the tool_result output onto the tool card and marks it success", () => {
		const tool = timeline.items.find((i): i is ToolItem => i.kind === "tool");
		expect(tool).toBeDefined();
		expect(tool?.name).toBe("Read");
		expect(tool?.status).toBe("success");
		// The Read of sample.txt returned its two lines.
		expect(tool?.output).toContain("hello world");
	});
});

describe("applyEvent incremental behaviour", () => {
	it("is a pure fold — identical to buildTimeline", () => {
		const events = loadEvents(TOOLS_SAMPLE);
		const folded = events.reduce(applyEvent, emptyTimeline());
		expect(folded).toEqual(buildTimeline(events));
	});

	it("returns a new object for state-changing events without mutating the old", () => {
		const init = loadEvents(TOOLS_SAMPLE).find(
			(e) => e.type === "system" && e.subtype === "init",
		);
		expect(init).toBeDefined();
		const s0 = emptyTimeline();
		const s1 = applyEvent(s0, init as ClaudeStreamEvent);
		expect(s1).not.toBe(s0);
		expect(s0.header).toBeUndefined(); // original untouched
		expect(s1.header).toBeDefined();
	});

	it("returns the SAME reference for no-op events (lets React skip renders)", () => {
		const s0 = emptyTimeline();
		// hook_started/status/stream_event carry no timeline change.
		const noop: ClaudeStreamEvent = {
			type: "system",
			subtype: "status",
			status: "requesting",
			session_id: "s",
			uuid: "u",
		};
		expect(applyEvent(s0, noop)).toBe(s0);
	});

	it("optimistically adds the user's typed prompt", () => {
		const s = withUserMessage(emptyTimeline(), "u1", "hello");
		expect(s.items[0]).toEqual({ kind: "user", id: "u1", text: "hello" });
		expect(s.status).toBe("streaming");
	});

	it("folds main's local_user_message echo into a user item", () => {
		// The CLI never echoes prompts back, so main records its own event when it
		// writes to stdin. That's what puts the user's half of the conversation in
		// the replay buffer a remounted pane rebuilds from.
		const s = applyEvent(emptyTimeline(), {
			type: "local_user_message",
			id: "u-pane-0",
			text: "what time is it",
		});
		expect(s.items).toEqual([
			{ kind: "user", id: "u-pane-0", text: "what time is it" },
		]);
		expect(s.status).toBe("streaming");
	});

	it("types assistant text out live from SSE deltas", () => {
		const events = loadEvents(TOOLS_SAMPLE);
		// Stop right after the first text delta of the final message — mid-stream.
		const upTo = events.findIndex(
			(e) =>
				e.type === "stream_event" &&
				e.event.type === "content_block_delta" &&
				e.event.delta.type === "text_delta",
		);
		expect(upTo).toBeGreaterThan(0);
		const mid = events.slice(0, upTo + 1).reduce(applyEvent, emptyTimeline());
		const streaming = mid.items.at(-1);
		expect(streaming?.kind).toBe("text");
		if (streaming?.kind === "text") {
			// "h" has landed but "ello" hasn't — this is the live-typing state.
			expect(streaming.text).toBe("h");
		}
		expect(mid.drafts.length).toBe(1);
		expect(mid.status).toBe("streaming");
	});

	it("finalizes a draft in place instead of appending a duplicate", () => {
		const events = loadEvents(TOOLS_SAMPLE);
		const final = buildTimeline(events);
		// One text item, not a draft plus a finished copy, and no drafts left over.
		expect(final.items.filter((i) => i.kind === "text").length).toBe(1);
		expect(final.drafts).toEqual([]);
		expect(final.items.some((i) => i.id.startsWith("stream:"))).toBe(false);
	});

	it("renders prompts from a stored transcript, string or blocks", () => {
		// Live `user` events only ever carry tool_result blocks; a transcript read
		// back off disk is where real prompts show up, often as a bare string.
		const fromString = applyEvent(emptyTimeline(), {
			type: "user",
			message: { role: "user", content: "fix the header" },
			parent_tool_use_id: null,
			session_id: "s",
			uuid: "evt-1",
		} as unknown as ClaudeStreamEvent);
		expect(fromString.items).toEqual([
			{ kind: "user", id: "evt-1", text: "fix the header" },
		]);

		const fromBlocks = applyEvent(emptyTimeline(), {
			type: "user",
			message: {
				role: "user",
				content: [{ type: "text", text: "and ship it" }],
			},
			parent_tool_use_id: null,
			session_id: "s",
			uuid: "evt-2",
		} as unknown as ClaudeStreamEvent);
		expect(fromBlocks.items).toEqual([
			{ kind: "user", id: "evt-2", text: "and ship it" },
		]);
	});

	it("still pairs tool output when a user event mixes text and results", () => {
		const withTool = applyEvent(emptyTimeline(), {
			type: "assistant",
			message: {
				id: "m1",
				content: [
					{ type: "tool_use", id: "toolu_1", name: "Read", input: { a: 1 } },
				],
			},
			parent_tool_use_id: null,
			session_id: "s",
			uuid: "a1",
		} as unknown as ClaudeStreamEvent);
		const paired = applyEvent(withTool, {
			type: "user",
			message: {
				role: "user",
				content: [
					{ type: "text", text: "keep going" },
					{ type: "tool_result", tool_use_id: "toolu_1", content: "done" },
				],
			},
			parent_tool_use_id: null,
			session_id: "s",
			uuid: "u1",
		} as unknown as ClaudeStreamEvent);
		const tool = paired.items.find((i): i is ToolItem => i.kind === "tool");
		expect(tool?.status).toBe("success");
		expect(tool?.output).toBe("done");
		expect(paired.items.some((i) => i.kind === "user")).toBe(true);
	});

	it("settles a loaded transcript so it doesn't look mid-turn", () => {
		// Transcripts carry no `result` event, so the raw fold ends "streaming".
		const loaded = applyEvent(emptyTimeline(), {
			type: "user",
			message: { role: "user", content: "hello" },
			parent_tool_use_id: null,
			session_id: "s",
			uuid: "evt-3",
		} as unknown as ClaudeStreamEvent);
		expect(loaded.status).toBe("streaming");
		expect(settled(loaded).status).toBe("idle");
		expect(settled(loaded).items).toEqual(loaded.items);
	});

	it("settles the timeline when a notice reports the session died", () => {
		// A spawn failure mid-turn used to leave the pane on a spinner forever.
		const streaming = applyEvent(emptyTimeline(), {
			type: "local_user_message",
			id: "u-1",
			text: "go",
		});
		expect(streaming.status).toBe("streaming");
		const dead = applyEvent(streaming, {
			type: "local_notice",
			id: "n-1",
			text: "Couldn't start Claude: spawn ENOENT",
			fatal: true,
		});
		expect(dead.status).toBe("error");
		expect(dead.drafts).toEqual([]);
		expect(dead.items.at(-1)).toEqual({
			kind: "notice",
			id: "n-1",
			text: "Couldn't start Claude: spawn ENOENT",
			fatal: true,
		});
	});

	it("leaves a non-fatal notice as information, not an ending", () => {
		const state = applyEvent(emptyTimeline(), {
			type: "local_notice",
			id: "n-2",
			text: "Opened a forked copy.",
		});
		expect(state.status).toBe("idle");
	});

	it("reads context off the last request, and the window off the result", () => {
		const timeline = buildTimeline(loadEvents(TOOLS_SAMPLE));
		// The final main-agent request carried 2 + 152 + 30,530.
		//
		// Summing the result's modelUsage instead gave 61,216 on this same two-turn
		// sample — turn one's cache CREATION comes back as turn two's cache READ,
		// so it lands twice. Over a real session that error compounds per turn:
		// it read 33.5M against a 1M window on a conversation actually at 419k.
		expect(timeline.usage).toEqual({
			contextTokens: 2 + 152 + 30_530,
			contextWindow: 1_000_000,
		});
	});

	it("reports no usage rather than a zero when the shape is unexpected", () => {
		const base = buildTimeline(loadEvents(TOOLS_SAMPLE));
		const broken = applyEvent(emptyTimeline(), {
			type: "result",
			subtype: "success",
			is_error: false,
			result: "",
			session_id: "s",
			uuid: "r1",
			num_turns: 1,
			duration_ms: 10,
			duration_api_ms: 5,
			total_cost_usd: 0,
			stop_reason: null,
			terminal_reason: "done",
			usage: {},
			modelUsage: {},
			permission_denials: [],
			api_error_status: null,
		} as unknown as ClaudeStreamEvent);
		expect(broken.usage).toBeUndefined();
		// The good path still works, so this isn't passing by accident.
		expect(base.usage?.contextTokens).toBeGreaterThan(0);
	});

	it("clears a failure when a restarted session says hello", () => {
		// Restarting a dead session must not leave it rendering as dead: the
		// Restart bar and the red status dot both key off this.
		const dead = applyEvent(emptyTimeline(), {
			type: "local_notice",
			id: "n-1",
			text: "Claude exited with code 1.",
			fatal: true,
		});
		expect(dead.status).toBe("error");
		const init = loadEvents(TOOLS_SAMPLE).find(
			(e) => e.type === "system" && e.subtype === "init",
		);
		expect(init).toBeDefined();
		const revived = applyEvent(dead, init as ClaudeStreamEvent);
		expect(revived.status).toBe("streaming");
		// The failure stays in the transcript — it happened.
		expect(revived.items.some((i) => i.kind === "notice")).toBe(true);
	});

	it("rebuilds an identical timeline from a replayed buffer", () => {
		const events = loadEvents(TOOLS_SAMPLE);
		// Main buffers only timeline-bearing events — the SSE deltas and status
		// pings it drops must not change the result of the fold.
		const replayed = buildTimeline(
			events.filter(
				(e) =>
					e.type !== "stream_event" &&
					!(e.type === "system" && e.subtype !== "init"),
			),
		);
		expect(replayed).toEqual(buildTimeline(events));
	});
});

describe("groupSubagents", () => {
	it("keeps top-level work at the top and nests by parent tool id", () => {
		const items = buildTimeline(loadEvents(TOOLS_SAMPLE)).items;
		const { topLevel, groups } = groupSubagents(items);
		// This transcript has no subagents, so everything is top-level.
		expect(topLevel.length).toBe(items.length);
		expect(groups.size).toBe(0);
	});

	it("routes a child item under its parent tool id", () => {
		const grouped = groupSubagents([
			{
				kind: "tool",
				id: "toolu_parent",
				toolUseId: "toolu_parent",
				name: "Task",
				input: {},
				status: "running",
				parentToolUseId: null,
			},
			{
				kind: "text",
				id: "child:0",
				text: "subagent step",
				parentToolUseId: "toolu_parent",
			},
		]);
		expect(grouped.topLevel.length).toBe(1);
		expect(grouped.groups.get("toolu_parent")?.length).toBe(1);
	});
});

describe("context measurement", () => {
	test("a request's own usage IS the context it carried", () => {
		expect(
			readAssistantContext({
				input_tokens: 12,
				cache_read_input_tokens: 400_000,
				cache_creation_input_tokens: 8_000,
			}),
		).toBe(408_012);
	});

	test("output tokens are not context — they weren't sent to the model", () => {
		expect(
			readAssistantContext({ input_tokens: 100, output_tokens: 5_000 }),
		).toBe(100);
	});

	test("missing or zero usage reports nothing rather than zero", () => {
		expect(readAssistantContext(undefined)).toBeUndefined();
		expect(readAssistantContext({})).toBeUndefined();
		expect(readAssistantContext({ input_tokens: 0 })).toBeUndefined();
	});

	test("junk fields are ignored instead of poisoning the sum", () => {
		expect(
			readAssistantContext({
				input_tokens: 10,
				cache_read_input_tokens: Number.NaN,
				cache_creation_input_tokens: "lots",
			}),
		).toBe(10);
	});

	test("context does NOT accumulate across turns", () => {
		// The bug: summing a result's cumulative modelUsage read 33.5M against a
		// 1M window, because every turn re-reads the whole conversation from cache.
		// Each assistant message must report the context of THAT request alone.
		let state = emptyTimeline();
		const turn = (cacheRead: number) =>
			({
				type: "assistant",
				message: {
					id: `m-${cacheRead}`,
					content: [{ type: "text", text: "ok" }],
					usage: { input_tokens: 5, cache_read_input_tokens: cacheRead },
				},
				parent_tool_use_id: null,
				session_id: "s",
				uuid: `u-${cacheRead}`,
			}) as unknown as ClaudeStreamEvent;

		state = applyEvent(state, turn(100_000));
		state = applyEvent(state, turn(200_000));
		state = applyEvent(state, turn(300_000));

		// The latest request, not 600k of accumulated cache reads.
		expect(state.usage?.contextTokens).toBe(300_005);
	});

	test("a subagent's smaller context doesn't overwrite the conversation's", () => {
		let state = emptyTimeline();
		const main = {
			type: "assistant",
			message: {
				id: "m1",
				content: [{ type: "text", text: "main" }],
				usage: { input_tokens: 400_000 },
			},
			parent_tool_use_id: null,
			session_id: "s",
			uuid: "u1",
		} as unknown as ClaudeStreamEvent;
		const sub = {
			type: "assistant",
			message: {
				id: "m2",
				content: [{ type: "text", text: "sub" }],
				usage: { input_tokens: 900 },
			},
			parent_tool_use_id: "tool-1",
			session_id: "s",
			uuid: "u2",
		} as unknown as ClaudeStreamEvent;

		state = applyEvent(state, main);
		state = applyEvent(state, sub);
		expect(state.usage?.contextTokens).toBe(400_000);
	});
});

describe("cost across CLI processes", () => {
	function result(costUsd: number, uuid: string): ClaudeStreamEvent {
		return {
			type: "result",
			subtype: "success",
			uuid,
			session_id: "s",
			result: "ok",
			is_error: false,
			total_cost_usd: costUsd,
			duration_ms: 10,
			num_turns: 1,
		} as unknown as ClaudeStreamEvent;
	}

	function init(uuid: string): ClaudeStreamEvent {
		return {
			type: "system",
			subtype: "init",
			uuid,
			session_id: "s",
			model: "claude",
			cwd: "/repo",
			permissionMode: "bypassPermissions",
			slash_commands: [],
			skills: [],
			agents: [],
			mcp_servers: [],
		} as unknown as ClaudeStreamEvent;
	}

	it("takes the latest figure within one process, not the sum", () => {
		// The CLI's number is already cumulative for the run, so adding each
		// report would roughly double the bill.
		let state = emptyTimeline();
		state = applyEvent(state, init("i1"));
		state = applyEvent(state, result(0.1, "r1"));
		state = applyEvent(state, result(0.3, "r2"));
		expect(state.costUsd).toBeCloseTo(0.3, 6);
	});

	it("keeps accruing when a new process restarts the count at zero", () => {
		// This is the reported bug: resuming after a restart, a profile switch or
		// a rate-limit wait started a new process, whose total began again at
		// zero, and the displayed cost reset with it.
		let state = emptyTimeline();
		state = applyEvent(state, init("i1"));
		state = applyEvent(state, result(0.5, "r1"));
		state = applyEvent(state, init("i2"));
		state = applyEvent(state, result(0.2, "r2"));
		expect(state.costUsd).toBeCloseTo(0.7, 6);
	});

	it("survives a new process whose init was never seen", () => {
		// A drop without an init still means a fresh process reporting, so the
		// whole figure is new spend rather than a negative delta.
		let state = emptyTimeline();
		state = applyEvent(state, result(0.5, "r1"));
		state = applyEvent(state, result(0.2, "r2"));
		expect(state.costUsd).toBeCloseTo(0.7, 6);
	});

	it("ignores a missing or nonsensical figure rather than zeroing the total", () => {
		let state = emptyTimeline();
		state = applyEvent(state, result(0.4, "r1"));
		state = applyEvent(state, result(Number.NaN, "r2"));
		state = applyEvent(state, result(-1, "r3"));
		expect(state.costUsd).toBeCloseTo(0.4, 6);
	});
});
