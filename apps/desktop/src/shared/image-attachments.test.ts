import { describe, expect, test } from "bun:test";
import { z } from "zod";
import {
	chatImageSchema,
	chatImageUrlSchema,
	imageMimeType,
	MAX_CHAT_IMAGE_BYTES,
	MAX_CHAT_IMAGES,
} from "./image-attachments";
import { queuedPromptSchema, storedQueuedPromptSchema } from "./session-queue";

describe("chat image limits", () => {
	test("an older oversized queued image stays recoverable but cannot be sent unchanged", () => {
		const prompt = {
			provider: "codex",
			text: "Keep this draft",
			model: "model",
			effort: "high",
			permission: "default",
			images: [
				`data:image/png;base64,${Buffer.alloc(6 * 1024 * 1024).toString("base64")}`,
			],
		};
		expect(storedQueuedPromptSchema.safeParse(prompt).success).toBe(true);
		expect(queuedPromptSchema.safeParse(prompt).success).toBe(false);
	});
	test("5 MB means decoded bytes, including base64 padding", () => {
		const data = Buffer.alloc(MAX_CHAT_IMAGE_BYTES).toString("base64");
		expect(
			chatImageSchema.safeParse({
				name: "large.png",
				mediaType: "image/png",
				data,
			}).success,
		).toBe(true);
		expect(
			chatImageUrlSchema.safeParse(`data:image/png;base64,${data}`).success,
		).toBe(true);
		expect(
			chatImageUrlSchema.safeParse(
				`data:image/png;base64,${Buffer.alloc(MAX_CHAT_IMAGE_BYTES + 1).toString("base64")}`,
			).success,
		).toBe(false);
	});
	test("direct and queued messages accept 20 images and reject the 21st", () => {
		const image = { name: "shot.png", mediaType: "image/png", data: "YQ==" };
		for (const count of [20, 21]) {
			const images = Array.from({ length: count }, () => image);
			expect(
				z.array(chatImageSchema).max(MAX_CHAT_IMAGES).safeParse(images).success,
			).toBe(count === 20);
			expect(
				queuedPromptSchema.safeParse({
					provider: "claude",
					text: "Review",
					images,
				}).success,
			).toBe(count === 20);
			expect(
				queuedPromptSchema.safeParse({
					provider: "codex",
					text: "Review",
					model: "test",
					effort: "low",
					permission: "read-only",
					images: images.map((i) => `data:${i.mediaType};base64,${i.data}`),
				}).success,
			).toBe(count === 20);
		}
	});
	test("Windows images without MIME do not fall into the 200 KB text-file path", () => {
		expect(imageMimeType({ type: "", name: "Screenshot.PNG" })).toBe(
			"image/png",
		);
		expect(
			imageMimeType({ type: "application/octet-stream", name: "photo.jpeg" }),
		).toBe("image/jpeg");
		expect(imageMimeType({ type: "text/plain", name: "fake.png" })).toBeNull();
		expect(imageMimeType({ type: "", name: "notes.txt" })).toBeNull();
	});
	test("rejects malformed base64 and active-content image types", () => {
		for (const url of [
			"data:image/svg+xml;base64,YQ==",
			"data:image/png;base64,abc",
			"data:image/png;base64,ab c",
			"https://example.com/image.png",
		])
			expect(chatImageUrlSchema.safeParse(url).success).toBe(false);
	});
});
