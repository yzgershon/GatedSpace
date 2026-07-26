import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	type ClaudeStreamEvent,
	isInitEvent,
	isResultEvent,
	parseStreamLine,
} from "./events";

// The two transcripts were captured from the real installed CLI (2.1.218).
// If the protocol shape drifts, these tests fail against reality, not a mock.
const PLANS_DIR = join(import.meta.dir, "../../../plans");
const SAMPLES = [
	"20260723-claude-code-session-ui-schema-sample.jsonl",
	"20260724-claude-code-stream-tools-sample.jsonl",
];

const KNOWN_TYPES = new Set([
	"system",
	"assistant",
	"user",
	"stream_event",
	"rate_limit_event",
	"result",
]);

function loadEvents(file: string): ClaudeStreamEvent[] {
	const text = readFileSync(join(PLANS_DIR, file), "utf-8");
	return text
		.split("\n")
		.map(parseStreamLine)
		.filter((e): e is ClaudeStreamEvent => e !== null);
}

describe("parseStreamLine against real captured transcripts", () => {
	it("parses every non-blank line in both samples", () => {
		for (const file of SAMPLES) {
			const text = readFileSync(join(PLANS_DIR, file), "utf-8");
			const nonBlank = text.split("\n").filter((l) => l.trim().length > 0);
			const parsed = nonBlank.map(parseStreamLine);
			expect(parsed.every((e) => e !== null)).toBe(true);
			expect(parsed.length).toBe(nonBlank.length);
		}
	});

	it("only emits known top-level event types", () => {
		for (const file of SAMPLES) {
			for (const e of loadEvents(file)) {
				expect(KNOWN_TYPES.has(e.type)).toBe(true);
			}
		}
	});

	it("returns null for blank and malformed lines", () => {
		expect(parseStreamLine("")).toBeNull();
		expect(parseStreamLine("   ")).toBeNull();
		expect(parseStreamLine("{not json")).toBeNull();
		expect(parseStreamLine("42")).toBeNull();
		expect(parseStreamLine('{"no":"type field"}')).toBeNull();
	});
});

describe("session header (system/init)", () => {
	it("exposes slash_commands, skills, agents and MCP servers", () => {
		const init = loadEvents(SAMPLES[0]).find(isInitEvent);
		expect(init).toBeDefined();
		if (!init) return;
		expect(Array.isArray(init.slash_commands)).toBe(true);
		expect(init.slash_commands.length).toBeGreaterThan(0);
		expect(Array.isArray(init.skills)).toBe(true);
		expect(Array.isArray(init.agents)).toBe(true);
		expect(Array.isArray(init.mcp_servers)).toBe(true);
		// The whole point of the session UI: runs on the subscription, no API key.
		expect(init.apiKeySource).toBe("none");
	});
});

describe("tool activity (from the richer sample)", () => {
	const events = loadEvents(SAMPLES[1]);

	it("surfaces a tool_use block inside an assistant message", () => {
		const toolUse = events
			.filter((e) => e.type === "assistant")
			.flatMap((e) => (e.type === "assistant" ? e.message.content : []))
			.find((b) => b.type === "tool_use");
		expect(toolUse).toBeDefined();
		if (toolUse?.type === "tool_use") {
			expect(typeof toolUse.id).toBe("string");
			expect(typeof toolUse.name).toBe("string");
			expect(toolUse.input).toBeInstanceOf(Object);
		}
	});

	it("pairs it with a tool_result carrying the same tool_use_id", () => {
		const toolUseId = events
			.filter((e) => e.type === "assistant")
			.flatMap((e) => (e.type === "assistant" ? e.message.content : []))
			.find((b) => b.type === "tool_use")?.id;

		const userEvent = events.find(
			(e): e is Extract<ClaudeStreamEvent, { type: "user" }> =>
				e.type === "user",
		);
		const content = userEvent?.message as {
			content?: Array<{ tool_use_id?: string; type?: string }>;
		};
		const result = content?.content?.find((b) => b.type === "tool_result");
		expect(result).toBeDefined();
		expect(result?.tool_use_id).toBe(toolUseId);
	});
});

describe("end-of-turn rundown (result)", () => {
	it("carries cost, duration and usage", () => {
		const result = loadEvents(SAMPLES[1]).find(isResultEvent);
		expect(result).toBeDefined();
		if (!result) return;
		expect(typeof result.total_cost_usd).toBe("number");
		expect(typeof result.duration_ms).toBe("number");
		expect(result.usage).toBeInstanceOf(Object);
	});
});
