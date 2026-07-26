/**
 * Tests for the pure decisions behind a timeline row.
 *
 * These are extracted from the component on purpose. The rendering can only be
 * checked by eye, but "which argument identifies this call" and "how many lines
 * did this edit add" are answerable, and getting them wrong is exactly the kind
 * of thing that looks fine on the one transcript you happened to open.
 */
import { describe, expect, test } from "bun:test";
import type { ToolItem } from "shared/claude-session/timeline";
import {
	editPairs,
	editSummary,
	searchSummary,
	toolArgument,
} from "./SessionTimelineView";

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

describe("toolArgument", () => {
	test("a search shows its param name, quoted, in monospace", () => {
		expect(
			toolArgument(tool("Glob", { pattern: "C:\\Dev\\Flow\\*.csproj" })),
		).toEqual({
			label: "pattern:",
			value: '"C:\\Dev\\Flow\\*.csproj"',
			mono: true,
		});
	});

	test("a shell prefers its prose description over the command", () => {
		expect(
			toolArgument(
				tool("Bash", {
					command: "claude --help 2>&1 | head -20",
					description: "Check Claude Code programmatic flags",
				}),
			),
		).toEqual({ value: "Check Claude Code programmatic flags", mono: false });
	});

	test("a shell with no description falls back to the command", () => {
		expect(toolArgument(tool("Bash", { command: "git status" }))).toEqual({
			value: "git status",
			mono: true,
		});
	});

	test("a file tool shows its path in monospace", () => {
		expect(
			toolArgument(
				tool("Read", { file_path: "C:\\Dev\\Flow\\GatedVoice.csproj" }),
			),
		).toEqual({ value: "C:\\Dev\\Flow\\GatedVoice.csproj", mono: true });
	});

	test("Task has neither path nor command, so its description carries the row", () => {
		expect(
			toolArgument(tool("Task", { description: "Audit the theme tokens" })),
		).toEqual({ value: "Audit the theme tokens", mono: false });
	});

	test("a blank field is treated as absent", () => {
		expect(
			toolArgument(tool("Bash", { description: "   ", command: "ls" })),
		).toEqual({ value: "ls", mono: true });
	});

	test("nothing recognisable means no argument rather than an empty one", () => {
		expect(toolArgument(tool("Mystery", { limit: 5 }))).toBeNull();
	});
});

describe("editPairs", () => {
	test("an Edit is one pair", () => {
		expect(
			editPairs(tool("Edit", { old_string: "a", new_string: "b" })),
		).toEqual([{ oldString: "a", newString: "b" }]);
	});

	test("a MultiEdit is one pair per entry, in order", () => {
		expect(
			editPairs(
				tool("MultiEdit", {
					edits: [
						{ old_string: "a", new_string: "b" },
						{ old_string: "c", new_string: "d" },
					],
				}),
			),
		).toEqual([
			{ oldString: "a", newString: "b" },
			{ oldString: "c", newString: "d" },
		]);
	});

	test("junk entries in an edits list are skipped, not rendered as blanks", () => {
		expect(
			editPairs(
				tool("MultiEdit", {
					edits: [null, {}, { old_string: "a", new_string: "b" }],
				}),
			),
		).toEqual([{ oldString: "a", newString: "b" }]);
	});

	test("a Write is a pair against an empty original: all of it is new", () => {
		expect(editPairs(tool("Write", { content: "line\nline" }))).toEqual([
			{ oldString: "", newString: "line\nline" },
		]);
	});

	test("an edit with nothing to show yields no pairs", () => {
		expect(editPairs(tool("Edit", { file_path: "a.ts" }))).toEqual([]);
	});
});

describe("editSummary", () => {
	test("net growth reads as added lines", () => {
		expect(
			editSummary(tool("Edit", { old_string: "a", new_string: "a\nb\nc" })),
		).toBe("Added 2 lines");
	});

	test("net shrink reads as removed lines", () => {
		expect(
			editSummary(tool("Edit", { old_string: "a\nb\nc", new_string: "a" })),
		).toBe("Removed 2 lines");
	});

	test("a same-size rewrite still says something happened", () => {
		expect(
			editSummary(tool("Edit", { old_string: "a", new_string: "b" })),
		).toBe("Edited");
	});

	test("one line is singular", () => {
		expect(
			editSummary(tool("Edit", { old_string: "a", new_string: "a\nb" })),
		).toBe("Added 1 line");
	});

	test("a MultiEdit sums its entries", () => {
		expect(
			editSummary(
				tool("MultiEdit", {
					edits: [
						{ old_string: "a", new_string: "a\nb" },
						{ old_string: "c", new_string: "c\nd\ne" },
					],
				}),
			),
		).toBe("Added 3 lines");
	});

	test("nothing to diff means nothing to summarise", () => {
		expect(editSummary(tool("Edit", {}))).toBeNull();
	});
});

describe("searchSummary", () => {
	test("counts the hit lines", () => {
		expect(
			searchSummary(
				tool("Glob", { pattern: "*.ts" }, { output: "a.ts\nb.ts" }),
			),
		).toBe("Found 2 files");
	});

	test("one hit is singular", () => {
		expect(
			searchSummary(tool("Glob", { pattern: "*.ts" }, { output: "a.ts\n" })),
		).toBe("Found 1 file");
	});

	test("Grep counts matches, not files", () => {
		expect(
			searchSummary(
				tool("Grep", { pattern: "todo" }, { output: "a.ts:1\nb.ts:4" }),
			),
		).toBe("Found 2 matches");
	});

	test("an empty result says so instead of claiming zero files", () => {
		expect(
			searchSummary(tool("Glob", { pattern: "*.zz" }, { output: "" })),
		).toBe("No matches");
	});

	test("a still-running search reports nothing yet", () => {
		expect(
			searchSummary(tool("Glob", { pattern: "*.ts" }, { status: "running" })),
		).toBeNull();
	});
});
