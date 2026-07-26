/**
 * Treat a single newline as a line break, the way chat UIs do.
 *
 * Markdown's rule is that one newline is a space and only a blank line starts a
 * paragraph. That's right for prose someone wrote as markdown, and wrong for
 * text that merely PASSES THROUGH a markdown renderer — a CLI's `/usage` table,
 * a stack trace, an agent listing three bullets without blank lines between
 * them. Those arrive with meaningful newlines and come out as one run-on
 * paragraph.
 *
 * This is `remark-breaks` in about twenty lines. It isn't worth a dependency,
 * and having it here means the walk is visible at the point someone wonders why
 * their newlines survived.
 *
 * Scope: only `text` nodes are visited, so newlines inside code blocks, inline
 * code and HTML are untouched — those are literal nodes, not text, and breaking
 * them would corrupt the content rather than reflow it.
 */

interface MdastNode {
	type: string;
	value?: string;
	children?: MdastNode[];
}

/** Split one text node's value on newlines, interleaving `break` nodes. */
function splitOnNewlines(node: MdastNode): MdastNode[] {
	const value = node.value ?? "";
	if (!value.includes("\n")) return [node];

	const out: MdastNode[] = [];
	const segments = value.split("\n");
	segments.forEach((segment, index) => {
		if (index > 0) out.push({ type: "break" });
		// Markdown collapses trailing spaces before a newline; drop them so the
		// break doesn't leave a ragged space at the end of the line.
		const text =
			index < segments.length - 1 ? segment.replace(/\s+$/, "") : segment;
		if (text) out.push({ type: "text", value: text });
	});
	return out;
}

function transform(node: MdastNode): void {
	const children = node.children;
	if (!children) return;

	const next: MdastNode[] = [];
	for (const child of children) {
		if (child.type === "text") {
			next.push(...splitOnNewlines(child));
			continue;
		}
		transform(child);
		next.push(child);
	}
	node.children = next;
}

export function remarkHardBreaks() {
	return (tree: MdastNode) => {
		transform(tree);
	};
}
