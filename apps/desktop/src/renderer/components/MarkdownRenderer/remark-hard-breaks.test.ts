import { describe, expect, test } from "bun:test";
import { remarkHardBreaks } from "./remark-hard-breaks";

interface Node {
	type: string;
	value?: string;
	children?: Node[];
}

function text(value: string): Node {
	return { type: "text", value };
}

function run(tree: Node): Node {
	remarkHardBreaks()(tree);
	return tree;
}

describe("remarkHardBreaks", () => {
	test("splits a newline into a break between two text nodes", () => {
		const tree = run({
			type: "root",
			children: [{ type: "paragraph", children: [text("first\nsecond")] }],
		});
		expect(tree.children?.[0]?.children).toEqual([
			{ type: "text", value: "first" },
			{ type: "break" },
			{ type: "text", value: "second" },
		]);
	});

	test("leaves text without newlines exactly as it was", () => {
		const node = text("nothing to do here");
		const tree = run({
			type: "root",
			children: [{ type: "paragraph", children: [node] }],
		});
		// Same object, not a copy — untouched content shouldn't churn the tree.
		expect(tree.children?.[0]?.children?.[0]).toBe(node);
	});

	test("handles several newlines in one node", () => {
		const tree = run({
			type: "root",
			children: [{ type: "paragraph", children: [text("a\nb\nc")] }],
		});
		expect(tree.children?.[0]?.children?.map((n) => n.type)).toEqual([
			"text",
			"break",
			"text",
			"break",
			"text",
		]);
	});

	test("drops the trailing spaces markdown would have eaten anyway", () => {
		const tree = run({
			type: "root",
			children: [{ type: "paragraph", children: [text("first   \nsecond")] }],
		});
		expect(tree.children?.[0]?.children?.[0]).toEqual({
			type: "text",
			value: "first",
		});
	});

	test("a trailing newline yields a break, not an empty text node", () => {
		const tree = run({
			type: "root",
			children: [{ type: "paragraph", children: [text("only\n")] }],
		});
		expect(tree.children?.[0]?.children).toEqual([
			{ type: "text", value: "only" },
			{ type: "break" },
		]);
	});

	test("recurses into nested nodes like list items and emphasis", () => {
		const tree = run({
			type: "root",
			children: [
				{
					type: "list",
					children: [
						{
							type: "listItem",
							children: [{ type: "paragraph", children: [text("one\ntwo")] }],
						},
					],
				},
			],
		});
		const paragraph = tree.children?.[0]?.children?.[0]?.children?.[0];
		expect(paragraph?.children?.map((n) => n.type)).toEqual([
			"text",
			"break",
			"text",
		]);
	});

	test("never touches code, whose newlines are the content", () => {
		const code: Node = { type: "code", value: "line one\nline two" };
		const tree = run({ type: "root", children: [code] });
		expect(tree.children?.[0]).toEqual({
			type: "code",
			value: "line one\nline two",
		});
	});

	test("inline code inside a paragraph keeps its newlines too", () => {
		const tree = run({
			type: "root",
			children: [
				{
					type: "paragraph",
					children: [
						text("see "),
						{ type: "inlineCode", value: "a\nb" },
						text(" above"),
					],
				},
			],
		});
		expect(tree.children?.[0]?.children?.[1]).toEqual({
			type: "inlineCode",
			value: "a\nb",
		});
	});
});
