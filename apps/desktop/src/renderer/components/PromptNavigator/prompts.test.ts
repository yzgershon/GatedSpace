import { describe, expect, test } from "bun:test";
import { collectPrompts } from "./prompts";

describe("prompt navigation index", () => {
	test("keeps each user prompt, including image-only prompts, and never indexes tool or subagent chatter", () => {
		expect(
			collectPrompts([
				{ id: "intro", kind: "assistant", text: "A resumed answer" },
				{
					id: "u1",
					kind: "user",
					text: "**Keep** [this layout](https://example.com)",
				},
				{ id: "tool", kind: "activity", text: "secret command output" },
				{
					id: "nested",
					kind: "text",
					text: "Subagent reply",
					parentToolUseId: "tool",
				},
				{ id: "a1", kind: "assistant", text: "The layout is preserved." },
				{ id: "a2", kind: "assistant", text: "Later update" },
				{
					id: "u2",
					kind: "user",
					images: ["image-data"],
					imagePaths: ["image.png"],
				},
				{ id: "u3", kind: "user", text: "Next prompt" },
			]),
		).toEqual([
			{
				id: "u1",
				text: "Keep this layout",
				reply: "The layout is preserved.",
				imageCount: 0,
			},
			{ id: "u2", text: "Image attachment", imageCount: 2 },
			{ id: "u3", text: "Next prompt", imageCount: 0 },
		]);
	});
	test("supports Claude text replies and bounds long previews", () => {
		const [entry] = collectPrompts([
			{ id: "u", kind: "user", text: "x".repeat(5000), attachments: [{}] },
			{ id: "a", kind: "text", text: "Reply\n\nwith spacing" },
		]);
		expect(entry.text.length).toBe(360);
		expect(entry.reply).toBe("Reply with spacing");
		expect(entry.imageCount).toBe(1);
	});
});
