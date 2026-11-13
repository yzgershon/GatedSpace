import { z } from "zod";

export const MAX_CHAT_IMAGES = 20;
export const MAX_CHAT_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGE_BASE64_LENGTH = Math.ceil(MAX_CHAT_IMAGE_BYTES / 3) * 4;
export const IMAGE_LIMIT_MESSAGE = "Attach up to 20 images, 5 MB each.";

export function imageMimeType(file: { type: string; name: string }) {
	const type = file.type.toLowerCase().split(";")[0].trim();
	if (/^image\/(png|jpeg|webp|gif|bmp|avif)$/.test(type)) return type;
	if (["image/jpg", "image/pjpeg", "image/jfif"].includes(type))
		return "image/jpeg";
	if (type === "image/x-png" || type === "image/apng") return "image/png";
	// Windows drag/drop can omit MIME even for ordinary screenshots.
	if (!file.type || file.type === "application/octet-stream") {
		const ext = file.name.split(".").at(-1)?.toLowerCase();
		if (ext && ["jpg", "jpeg", "jfif", "jpe"].includes(ext))
			return "image/jpeg";
		if (ext && ["png", "webp", "gif", "bmp", "avif"].includes(ext))
			return `image/${ext}`;
	}
	return null;
}

/** Windows clipboard and drag/drop metadata is not reliable. Inspect the
 * payload before considering a file as text, including extensionless images. */
export async function detectImageMime(file: File): Promise<string | null> {
	const bytes = new Uint8Array(await file.slice(0, 32).arrayBuffer());
	const ascii = String.fromCharCode(...bytes);
	if (bytes[0] === 0x89 && ascii.slice(1, 4) === "PNG") return "image/png";
	if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
		return "image/jpeg";
	if (/^GIF8[79]a/.test(ascii)) return "image/gif";
	if (ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WEBP")
		return "image/webp";
	if (ascii.startsWith("BM")) return "image/bmp";
	if (ascii.slice(4, 8) === "ftyp" && /avif|avis/.test(ascii.slice(8)))
		return "image/avif";
	return imageMimeType(file);
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
