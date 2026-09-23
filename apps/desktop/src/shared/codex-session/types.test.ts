import { describe, expect, test } from "bun:test";
import { normalizeCodexItem } from "./types";

describe("Codex activity normalization", () => {
	test("user images retain previews and local history paths separately from prompt text", () => {
		const item = normalizeCodexItem(
			{
				id: "images",
				type: "userMessage",
				content: [
					{ type: "text", text: "Check these screenshots" },
					{ type: "image", url: "data:image/png;base64,YWJj" },
					{ type: "localImage", path: "C:/work/screenshot.png" },
					{ type: "image", url: "javascript:alert(1)" },
				],
			},
			"turn",
		);
		expect(item).toMatchObject({
			text: "Check these screenshots",
			images: ["data:image/png;base64,YWJj"],
			imagePaths: ["C:/work/screenshot.png"],
		});
		expect(item?.text).not.toContain("Attached image");
	});
	test("preserves shell output, exit zero and measured duration", () => {
		const item = normalizeCodexItem(
			{
				id: "c",
				type: "commandExecution",
				command: "bun test",
				cwd: "C:/work",
				aggregatedOutput: "12 pass",
				exitCode: 0,
				durationMs: 3400,
			},
			"t",
		);
		expect(item).toMatchObject({
			command: "bun test",
			cwd: "C:/work",
			text: "12 pass",
			exitCode: 0,
			durationMs: 3400,
		});
	});
	test("parsed reads get readable labels without losing the exact command", () => {
		const item = normalizeCodexItem(
			{
				id: "c",
				type: "commandExecution",
				command: "Get-Content app.ts",
				commandActions: [
					{ type: "read", name: "app.ts", path: "C:/work/app.ts" },
				],
			},
			"t",
		);
		expect(item).toMatchObject({
			activityType: "read",
			title: "Read app.ts",
			command: "Get-Content app.ts",
		});
	});
	test("retains structured file diffs", () => {
		const changes = [
			{
				path: "app.ts",
				kind: { type: "update" },
				diff: "@@ -1 +1 @@\n-before\n+after",
			},
		];
		expect(
			normalizeCodexItem({ id: "f", type: "fileChange", changes }, "t")
				?.changes,
		).toEqual([{ ...changes[0], kind: "update" }]);
	});
	test("MCP captures render as images, never as base64 output", () => {
		const item = normalizeCodexItem(
			{
				id: "m",
				type: "mcpToolCall",
				server: "gatedspace_browser",
				tool: "browser_screenshot",
				arguments: { tabId: "tab" },
				result: {
					content: [
						{ type: "text", text: "Page captured" },
						{ type: "image", mimeType: "image/png", data: "YWJj" },
					],
				},
			},
			"t",
		);
		expect(item).toMatchObject({
			activityType: "browser",
			text: "Page captured",
			images: ["data:image/png;base64,YWJj"],
		});
		expect(item?.text).not.toContain("YWJj");
	});
	test("tool errors and structured content remain inspectable", () => {
		expect(
			normalizeCodexItem(
				{ id: "m", type: "mcpToolCall", error: { message: "Disconnected" } },
				"t",
			)?.text,
		).toContain("Disconnected");
		expect(
			normalizeCodexItem(
				{
					id: "m",
					type: "mcpToolCall",
					result: { structuredContent: { checked: true } },
				},
				"t",
			)?.text,
		).toContain('"checked": true');
	});
	test("only the provided reasoning summary is exposed", () => {
		expect(
			normalizeCodexItem(
				{
					id: "r",
					type: "reasoning",
					summary: ["Checking constraints"],
					content: ["private raw content"],
				},
				"t",
			)?.text,
		).toBe("Checking constraints");
	});
	test("dynamic and function image variants are supported without unsafe URLs", () => {
		const item = normalizeCodexItem(
			{
				id: "d",
				type: "dynamicToolCall",
				tool: "view",
				contentItems: [
					{ type: "inputImage", imageUrl: "data:image/png;base64,YWJj" },
					{ type: "inputImage", imageUrl: "file:///secret" },
					{ type: "inputText", text: "Screenshot" },
				],
			},
			"t",
		);
		expect(item?.images).toEqual(["data:image/png;base64,YWJj"]);
		expect(item?.text).toBe("Screenshot");
		expect(
			normalizeCodexItem(
				{
					id: "o",
					type: "functionCallOutput",
					name: "view",
					output: [
						{
							type: "input_image",
							image_url: "https://example.com/capture.png",
						},
					],
				},
				"t",
			)?.images,
		).toEqual(["https://example.com/capture.png"]);
	});
	test("web results preserve query and source data", () => {
		const item = normalizeCodexItem(
			{
				id: "w",
				type: "webSearch",
				query: "layout",
				results: [{ title: "Docs", url: "https://example.com" }],
			},
			"t",
		);
		expect(item?.text).toContain("layout");
		expect(item?.text).toContain("https://example.com");
	});
});
