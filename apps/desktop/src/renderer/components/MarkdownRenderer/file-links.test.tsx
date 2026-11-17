import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import {
	fileLinkSchema,
	localFileHref,
	localFilePath,
	markdownUrlTransform,
	rehypeLocalFileLinks,
} from "./file-links";

const render = (content: string) =>
	renderToStaticMarkup(
		<ReactMarkdown
			remarkPlugins={[remarkGfm]}
			rehypePlugins={[
				rehypeRaw,
				rehypeLocalFileLinks,
				[rehypeSanitize, fileLinkSchema],
			]}
			urlTransform={markdownUrlTransform}
		>
			{content}
		</ReactMarkdown>,
	);

describe("assistant file links through the real Markdown sanitizer", () => {
	test("keeps Windows paths clickable, including spaces and source coordinates", () => {
		for (const path of [
			"C:/Dev/report.md",
			"/C:/Dev/report.md:12",
			"file:///C:/Dev/report.md#L12",
		]) {
			expect(render(`[Report](${path})`)).toContain(
				'href="file:///C:/Dev/report.md"',
			);
		}
		expect(render("[My report](<C:/Dev/My report.md:12:4>)")).toContain(
			'href="file:///C:/Dev/My%20report.md"',
		);
		expect(render("[Report][r]\n\n[r]: C:/Dev/report.md")).toContain(
			'href="file:///C:/Dev/report.md"',
		);
		expect(localFilePath("file:///C:/Dev/My%20report.md")).toBe(
			"C:/Dev/My report.md",
		);
	});
	test("retains web links and does not linkify code examples", () => {
		expect(render("[Site](https://example.com/a?q=test)")).toContain(
			'href="https://example.com/a?q=test"',
		);
		expect(render("`[Report](C:/Dev/report.md)`")).not.toContain("<a");
		expect(localFileHref("/home/me/file.md")).toBe("file:///home/me/file.md");
	});
	test("rejects network paths and executable URI schemes without weakening HTML sanitization", () => {
		for (const link of [
			"file://server/share/file",
			"file:////server/share/file",
			"//server/file",
			"javascript:alert(1)",
			"data:text/html,hello",
		]) {
			expect(render(`[Bad](<${link}>)`)).not.toContain(`href="${link}"`);
		}
		expect(localFileHref("file:///C:%5c%5cserver%00/file")).toBeNull();
		expect(
			render(
				'<script>alert(1)</script><a href="C:/Dev/a.md" onclick="alert(1)">File</a>',
			),
		).not.toContain("onclick");
		expect(render('<img src="file:///C:/Dev/private.png">')).not.toContain(
			'src="file:',
		);
	});
});
