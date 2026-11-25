import { expect, test } from "bun:test";
import { mobileActivityTitle, mobileMarkdown } from "./message-format";

test("mobile tool headings hide raw shell code and keep useful file labels", () => {
	const command =
		'powershell.exe -Command "Get-Content app.ts; Write-Output done"';
	expect(mobileActivityTitle({ title: command, command })).toBe(
		"Ran a command",
	);
	expect(
		mobileActivityTitle({
			title: command,
			activityType: "commandExecution",
			status: "inProgress",
		}),
	).toBe("Running a command");
	expect(
		mobileActivityTitle({
			title: "Read app.ts",
			activityType: "read",
			command,
		}),
	).toBe("Read app.ts");
	expect(
		mobileActivityTitle({ title: `Searched ${"query ".repeat(100)}` }).length,
	).toBeLessThanOrEqual(90);
});

test("responses render Markdown, tables and code as readable content", () => {
	const html = mobileMarkdown(
		"## Ready\n\n**Done**, with `code`.\n\n- First\n- Second\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n```html\n<div>Example</div>\n```",
	);
	expect(html).toContain("<h2>Ready</h2>");
	expect(html).toContain("<strong>Done</strong>");
	expect(html).toContain("<li><p>First</p></li>");
	expect(html).toContain("<table>");
	expect(html).toContain("&lt;div&gt;Example&lt;/div&gt;");
});
test("transcript markup and unsafe links can never become executable HTML", () => {
	const html = mobileMarkdown(
		"<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[click](javascript:alert%281%29)\n\n[site](https://example.com?q=%22test%22)",
	);
	expect(html).not.toContain("<script");
	expect(html).not.toContain("<img");
	expect(html).not.toContain('href="javascript:');
	expect(html).toContain("&lt;script&gt;");
	expect(html).toContain('rel="noopener noreferrer"');
});
