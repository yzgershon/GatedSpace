/**
 * Tests for folding a run of bodyless tool calls.
 *
 * In their own file because `SessionTimelineView.tsx` cannot be imported from a
 * test: it reaches the electron tRPC client through the skin tokens, and that
 * has no global outside a renderer. The logic lives in `tool-folding.ts` for
 * exactly that reason.
 */
import { describe, expect, test } from "bun:test";
import type { ToolItem } from "shared/claude-session/timeline";
import { foldRuns, foldSummary } from "./tool-folding";

function tool(
	name: string,
	input: Record<string, unknown>,
	extra: Partial<ToolItem> = {},
): ToolItem {
	return {
		kind: "tool",
		id: `tool-${name}`,
		toolUseId: `use-${name}`,
		name,
		input,
		status: "success",
		parentToolUseId: null,
		...extra,
	};
}

/** A distinct id per call, so a run of the same tool is a run of real items. */
function call(
	name: string,
	n: number,
	extra: Partial<ToolItem> = {},
): ToolItem {
	return {
		...tool(name, {}, extra),
		id: `${name}-${n}`,
		toolUseId: `u-${name}-${n}`,
	};
}

describe("foldSummary", () => {
	test("counts each tool by its own verb and noun", () => {
		expect(
			foldSummary([call("Read", 1), call("Read", 2), call("Grep", 1)]),
		).toBe("Read 2 files, Searched 1 pattern");
	});

	test("keeps first-seen order rather than sorting", () => {
		expect(foldSummary([call("Grep", 1), call("Read", 1)])).toBe(
			"Searched 1 pattern, Read 1 file",
		);
	});

	/** Rewriting the list five times is still one list; a count would mislead. */
	test("does not count the todo list", () => {
		expect(foldSummary([call("TodoWrite", 1), call("TodoWrite", 2)])).toBe(
			"Updated todo list",
		);
	});

	test("falls back to a bare multiplier for an unmapped tool", () => {
		expect(foldSummary([call("Mystery", 1), call("Mystery", 2)])).toBe(
			"Mystery ×2",
		);
	});
});

describe("foldRuns", () => {
	test("returns every item untouched when folding is off", () => {
		const items = [call("Read", 1), call("Read", 2)];
		expect(foldRuns(items, false)).toEqual([
			{ kind: "item", item: items[0] as ToolItem },
			{ kind: "item", item: items[1] as ToolItem },
		]);
	});

	test("folds a consecutive run of bodyless calls", () => {
		const items = [call("Read", 1), call("Read", 2), call("Grep", 1)];
		const out = foldRuns(items, true);
		expect(out).toHaveLength(1);
		expect(out[0]?.kind).toBe("fold");
	});

	/** One call behind a "1 step" toggle costs a click and hides nothing. */
	test("leaves a run of one alone", () => {
		const out = foldRuns([call("Read", 1)], true);
		expect(out).toEqual([{ kind: "item", item: expect.anything() }]);
		expect(out[0]?.kind).toBe("item");
	});

	test("a tool with a body splits the run around it", () => {
		const out = foldRuns(
			[
				call("Read", 1),
				call("Read", 2),
				call("Bash", 1),
				call("Read", 3),
				call("Read", 4),
			],
			true,
		);
		expect(out.map((entry) => entry.kind)).toEqual(["fold", "item", "fold"]);
	});

	/**
	 * A running tool keeps its own row: the pulsing dot is how you can tell the
	 * agent has not stalled, and a summary line has nowhere to put it.
	 */
	test("never folds a call that is still running", () => {
		const out = foldRuns(
			[call("Read", 1), call("Read", 2, { status: "running" })],
			true,
		);
		expect(out.map((entry) => entry.kind)).toEqual(["item", "item"]);
	});

	/** The children ARE the body it is being folded for not having. */
	test("never folds a call with subagent children", () => {
		const parent = call("Read", 1);
		const groups = new Map([[parent.toolUseId, [call("Grep", 9)]]]);
		const out = foldRuns([parent, call("Read", 2)], true, groups);
		expect(out.map((entry) => entry.kind)).toEqual(["item", "item"]);
	});

	test("never folds a call still streaming as a draft", () => {
		const first = call("Read", 1);
		const out = foldRuns(
			[first, call("Read", 2)],
			true,
			undefined,
			new Set([first.id]),
		);
		expect(out.map((entry) => entry.kind)).toEqual(["item", "item"]);
	});
});
