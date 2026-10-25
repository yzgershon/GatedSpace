import { z } from "zod";

export const MAX_CHAT_IMAGES = 20;
export const MAX_CHAT_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGE_BASE64_LENGTH = Math.ceil(MAX_CHAT_IMAGE_BYTES / 3) * 4;
export const IMAGE_LIMIT_MESSAGE = "Attach up to 20 images, 5 MB each.";

export function imageMimeType(file: { type: string; name: string }) {
	if (/^image\/(png|jpeg|webp|gif)$/.test(file.type)) return file.type;
	// Windows drag/drop can omit MIME even for ordinary screenshots.
	if (!file.type || file.type === "application/octet-stream") {
		const ext = file.name.split(".").at(-1)?.toLowerCase();
		if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
		if (ext && ["png", "webp", "gif"].includes(ext)) return `image/${ext}`;
	}
	return null;
}

export function imageBase64Bytes(data: string) {
	return (
		(data.length / 4) * 3 -
		(data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0)
	);
}

const base64Image = z
	.string()
	.max(MAX_IMAGE_BASE64_LENGTH)
	.regex(/^[A-Za-z0-9+/]*={0,2}$/)
	.refine(
		(data) =>
			data.length > 0 &&
			data.length % 4 === 0 &&
			imageBase64Bytes(data) <= MAX_CHAT_IMAGE_BYTES,
		IMAGE_LIMIT_MESSAGE,
	);

export const chatImageSchema = z.object({
	name: z.string(),
	mediaType: z.string().regex(/^image\/(png|jpeg|webp|gif)$/),
	data: base64Image,
	width: z.number().optional(),
	height: z.number().optional(),
});

export const chatImageUrlSchema = z
	.string()
	.max(MAX_IMAGE_BASE64_LENGTH + 32)
	.refine((url) => {
		const match = /^data:image\/(png|jpeg|webp|gif);base64,(.*)$/.exec(url);
		return !!match && base64Image.safeParse(match[2]).success;
	}, IMAGE_LIMIT_MESSAGE);
