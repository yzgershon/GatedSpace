import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import type { CodexItem } from "../../../shared/codex-session/types";

/** Commands belong inside the disclosure, never in its phone-sized heading. */
export function mobileActivityTitle(
	item: Pick<CodexItem, "title" | "command" | "activityType" | "status">,
): string {
	if (
		item.activityType === "commandExecution" ||
		(item.command && item.title === item.command)
	) {
		return item.status === "inProgress" ? "Running a command" : "Ran a command";
	}
	const title = item.title.trim().replace(/\s+/g, " ") || "Used a tool";
	return title.length > 90 ? `${title.slice(0, 87)}…` : title;
}

const parser = unified().use(remarkParse).use(remarkGfm);
type MarkdownNode = ReturnType<typeof parser.parse>["children"][number];
const cache = new Map<string, string>();
const escapeHtml = (value: string) =>
	value.replace(
		/[&<>"']/g,
		(c) =>
			({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
				c
			] ?? c,
	);

/** Only our own elements are emitted. Transcript HTML is always inert text. */
export function mobileMarkdown(text: string): string {
	const cached = cache.get(text);
	if (cached !== undefined) return cached;
	const root = parser.parse(text);
	const definitions = new Map<
		string,
		Extract<MarkdownNode, { type: "definition" }>
	>();
	for (const node of root.children) {
		if (node.type === "definition") definitions.set(node.identifier, node);
	}
	function link(url: string, content: string) {
		if (!/^(https?:\/\/|mailto:)/i.test(url)) return content;
		return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${content}</a>`;
	}
	function render(node: MarkdownNode): string {
		const children =
			"children" in node ? node.children.map(render).join("") : "";
		switch (node.type) {
			case "text":
			case "html":
				return escapeHtml(node.value);
			case "paragraph":
				return `<p>${children}</p>`;
			case "strong":
				return `<strong>${children}</strong>`;
			case "emphasis":
				return `<em>${children}</em>`;
			case "delete":
				return `<del>${children}</del>`;
			case "inlineCode":
				return `<code>${escapeHtml(node.value)}</code>`;
			case "code":
				return `<pre><code>${escapeHtml(node.value)}</code></pre>`;
			case "heading":
				return `<h${node.depth}>${children}</h${node.depth}>`;
			case "blockquote":
				return `<blockquote>${children}</blockquote>`;
			case "list": {
				const tag = node.ordered ? "ol" : "ul";
				return `<${tag}${node.ordered && node.start ? ` start="${node.start}"` : ""}>${children}</${tag}>`;
			}
			case "listItem":
				return `<li>${node.checked == null ? "" : node.checked ? "☑ " : "☐ "}${children}</li>`;
			case "link":
				return link(node.url, children);
			case "linkReference":
				return link(definitions.get(node.identifier)?.url ?? "", children);
			case "image":
				return link(node.url, escapeHtml(node.alt || "Image"));
			case "imageReference":
				return link(
					definitions.get(node.identifier)?.url ?? "",
					escapeHtml(node.alt || "Image"),
				);
			case "break":
				return "<br>";
			case "thematicBreak":
				return "<hr>";
			case "table":
				return `<div class="table-scroll"><table>${children}</table></div>`;
			case "tableRow":
				return `<tr>${children}</tr>`;
			case "tableCell":
				return `<td>${children}</td>`;
			case "definition":
				return "";
			default:
				return children;
		}
	}
	const html = root.children.map(render).join("");
	// Keep a bounded cache; never retain entire long conversations or images here.
	if (text.length < 32_000) {
		if (cache.size >= 128) cache.delete(cache.keys().next().value ?? "");
		cache.set(text, html);
	}
	return html;
}
