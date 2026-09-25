import { expect, test } from "bun:test";
import { claudeFileChange, claudeTaskChanges } from "./changes";
import {
	applyEvent,
	emptyTimeline,
	type ToolItem,
	withUserMessage,
} from "./timeline";

const edit = (id: string, extra: Partial<ToolItem> = {}): ToolItem => ({
	kind: "tool",
	id,
	toolUseId: id,
	name: "Edit",
	status: "success",
	parentToolUseId: null,
	input: {
		file_path: "C:/work/a.ts",
		old_string: "old\n",
		new_string: "new\nextra\n",
	},
	...extra,
});

test("successful edits update the current task, deduplicate paths, and reset at a new prompt", () => {
	const items = [
		edit("older"),
		{ kind: "user" as const, id: "u", text: "Fix it" },
		edit("one"),
		edit("two", {
			input: {
				file_path: "c:\\work\\A.ts",
				old_string: "extra",
				new_string: "replacement",
			},
		}),
		edit("pending", { status: "running" }),
		edit("failed", { status: "error" }),
		edit("one"),
	];
	expect(claudeTaskChanges(items)).toEqual({ files: 1, added: 3, removed: 2 });
	expect(
		claudeTaskChanges([
			...items,
			{ kind: "user", id: "next", text: "Next task" },
		]),
	).toBeNull();
});

test("structured patches count actual replacements and omit context/header text", () => {
	const change = claudeFileChange(
		edit("x", { input: { file_path: "a.ts", replace_all: true } }),
		{
			structuredPatch: [
				{
					lines: [
						" context",
						"-old",
						"+new",
						"+extra",
						" context",
						"-old",
						"+new",
					],
				},
			],
		},
	);
	expect(change).toEqual({ path: "a.ts", added: 3, removed: 2 });
});

test("unknown overwrites do not invent deleted-line totals, new files have known counts", () => {
	const write = edit("w", {
		name: "Write",
		input: { file_path: "new.ts", content: "one\ntwo\n" },
	});
	expect(claudeFileChange(write, { type: "create" })).toEqual({
		path: "new.ts",
		added: 2,
		removed: 0,
	});
	expect(claudeTaskChanges([write])).toEqual({
		files: 1,
		added: null,
		removed: null,
	});
	expect(
		claudeFileChange(
			edit("e", {
				input: {
					file_path: "a",
					old_string: "a",
					new_string: "b",
					replace_all: true,
				},
			}),
		)?.added,
	).toBeNull();
});

test("live tool results preserve patch counts when the final assistant block arrives late", () => {
	let state = withUserMessage(emptyTimeline(), "prompt", "Fix it");
	state = {
		...state,
		items: [...state.items, edit("tool", { status: "running" })],
	};
	state = applyEvent(state, {
		type: "user",
		uuid: "result",
		session_id: "s",
		parent_tool_use_id: null,
		message: {
			role: "user",
			content: [
				{ type: "tool_result", tool_use_id: "tool", content: "Updated" },
			],
		},
		tool_use_result: {
			structuredPatch: [{ lines: ["-old", "+new", "+extra", "+third"] }],
		},
	});
	expect(claudeTaskChanges(state.items)).toEqual({
		files: 1,
		added: 3,
		removed: 1,
	});
	state = applyEvent(state, {
		type: "assistant",
		uuid: "assistant",
		session_id: "s",
		parent_tool_use_id: null,
		message: {
			id: "a",
			type: "message",
			model: "claude",
			stop_reason: "tool_use",
			stop_sequence: null,
			usage: { input_tokens: 1, output_tokens: 1 },
			role: "assistant",
			content: [
				{
					type: "tool_use",
					id: "tool",
					name: "Edit",
					input: edit("tool").input,
				},
			],
		},
	});
	expect(claudeTaskChanges(state.items)).toEqual({
		files: 1,
		added: 3,
		removed: 1,
	});
});
