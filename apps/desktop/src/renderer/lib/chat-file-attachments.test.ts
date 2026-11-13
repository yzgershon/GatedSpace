import { describe, expect, test } from "bun:test";
import { appendFileReference, resolveChatFile } from "./chat-file-attachments";

describe("chat file attachments", () => {
	for (const name of [
		"brief.pdf",
		"Essay draft.docx",
		"budget.xlsx",
		"archive.zip",
		"recording.mp4",
		"source.ts",
		"diagram.svg",
	]) {
		test(`references local ${name} without the inline text limit`, async () => {
			const file = new File([new Uint8Array(400_000)], name);
			const path = `C:\\Project files\\${name}`;
			expect(await resolveChatFile(file, () => path)).toEqual({
				kind: "reference",
				text: path,
			});
		});
	}
	test("images retain the image pipeline even when they have a local path", async () => {
		const file = new File(
			[new Uint8Array([0x89, 0x50, 0x4e, 0x47])],
			"clipboard",
		);
		expect(await resolveChatFile(file, () => "C:\\image.png")).toEqual({
			kind: "image",
			mime: "image/png",
		});
	});
	test("local folders can be referenced without reading their bytes", async () => {
		const file = new File([], "Project folder");
		file.slice = () => {
			throw new Error("Is a directory");
		};
		expect(await resolveChatFile(file, () => "C:\\Project folder")).toEqual({
			kind: "reference",
			text: "C:\\Project folder",
		});
	});
	test("clipboard text works when no local path exists", async () => {
		const file = new File(["hello"], "notes.txt", { type: "text/plain" });
		expect(await resolveChatFile(file, () => "")).toEqual({
			kind: "reference",
			text: "File: notes.txt\n```\nhello\n```",
		});
	});
	test("path bridge failure still allows clipboard text", async () => {
		const file = new File(["hi"], "notes.md");
		expect(
			(
				await resolveChatFile(file, () => {
					throw new Error("No backing file");
				})
			).kind,
		).toBe("reference");
	});
	test("a synthetic binary cannot pretend to be an accessible path", async () => {
		await expect(
			resolveChatFile(new File(["binary"], "fake.pdf"), () => ""),
		).rejects.toThrow("no local path");
	});
	test("unreadable images report failure instead of falling back to a text attachment", async () => {
		const file = new File([], "photo.png", { type: "image/png" });
		file.slice = () => {
			throw new Error("Access denied");
		};
		await expect(resolveChatFile(file, () => "C:\\photo.png")).rejects.toThrow(
			"Could not read photo.png",
		);
	});
	test("references preserve the existing prompt and paths with spaces", () => {
		expect(
			appendFileReference("Review this", "C:\\Project files\\brief.pdf"),
		).toBe("Review this\n\nC:\\Project files\\brief.pdf");
		expect(appendFileReference("", "C:\\brief.pdf")).toBe("C:\\brief.pdf");
	});
});
