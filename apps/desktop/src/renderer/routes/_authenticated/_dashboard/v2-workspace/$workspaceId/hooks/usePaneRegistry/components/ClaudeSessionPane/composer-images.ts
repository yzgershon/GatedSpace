/**
 * Turning a pasted, dropped or picked file into something the CLI can be sent.
 *
 * Kept out of the composer so the sizing rules are testable: what gets sent is
 * a token cost on every subsequent turn of the conversation, and "it looked
 * fine" is not a way to check that.
 *
 * Screenshots are the case that matters here, so everything is re-encoded as
 * PNG. JPEG would be smaller but it smears text, and a screenshot whose text
 * can't be read is worth nothing.
 */
import type { UserImagePayload } from "shared/claude-session/events";

/**
 * Longest edge we send. Anthropic scales anything larger down to roughly this
 * before the model sees it, so sending more costs upload time and buys nothing.
 * A 2560px-wide screenshot lands here at about 40% of its original bytes.
 */
export const MAX_IMAGE_EDGE = 1568;

/** Files bigger than this aren't screenshots, and won't survive the API anyway. */
export const MAX_SOURCE_BYTES = 30 * 1024 * 1024;

export class ImageTooLargeError extends Error {
	constructor(name: string) {
		super(`${name} is too large to attach`);
		this.name = "ImageTooLargeError";
	}
}

/**
 * The scale factor to bring `width`×`height` under the edge limit, capped at 1
 * so a small image is never blown UP — upscaling a 200px icon would cost tokens
 * to add nothing but blur.
 */
export function scaleFactor(
	width: number,
	height: number,
	maxEdge = MAX_IMAGE_EDGE,
): number {
	const longest = Math.max(width, height);
	if (longest <= maxEdge || longest === 0) return 1;
	return maxEdge / longest;
}

/** The dimensions an image ends up at once the edge limit is applied. */
export function targetSize(
	width: number,
	height: number,
	maxEdge = MAX_IMAGE_EDGE,
): { width: number; height: number } {
	const factor = scaleFactor(width, height, maxEdge);
	if (factor === 1) return { width, height };
	// Round, not ceil: the factor is a float, so an exact result like 882 comes
	// out as 882.0000000000001 and ceil turns that into a whole extra pixel. The
	// max(1) is what stops a 1px-tall strip rounding away to a zero-size canvas.
	return {
		width: Math.max(1, Math.round(width * factor)),
		height: Math.max(1, Math.round(height * factor)),
	};
}

/** Bytes as something readable on a chip: "2.4 MB". */
export function formatBytes(bytes: number): string {
	if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
	return `${bytes} B`;
}

/**
 * A pasted screenshot arrives named "image.png" at best and unnamed at worst.
 * Give it something that reads as a filename, since that's what the chip shows.
 */
export function attachmentName(file: File, index: number): string {
	if (file.name?.trim()) return file.name;
	return `pasted-${index + 1}.png`;
}

/**
 * Decode, downscale if needed, re-encode as PNG, hand back base64 plus the
 * dimensions actually being sent.
 */
export async function prepareImage(
	file: File,
	index = 0,
): Promise<UserImagePayload> {
	if (file.size > MAX_SOURCE_BYTES) {
		throw new ImageTooLargeError(attachmentName(file, index));
	}

	const bitmap = await createImageBitmap(file);
	try {
		const size = targetSize(bitmap.width, bitmap.height);
		const canvas = document.createElement("canvas");
		canvas.width = size.width;
		canvas.height = size.height;
		const context = canvas.getContext("2d");
		if (!context) throw new Error("no 2d context");
		context.drawImage(bitmap, 0, 0, size.width, size.height);

		const dataUrl = canvas.toDataURL("image/png");
		const data = dataUrl.slice(dataUrl.indexOf(",") + 1);
		return {
			name: attachmentName(file, index),
			mediaType: "image/png",
			width: size.width,
			height: size.height,
			data,
			thumbnail: makeThumbnail(bitmap),
		};
	} finally {
		bitmap.close();
	}
}

/**
 * The longest edge of the preview kept for the conversation.
 *
 * Small on purpose. Unlike the full image, this one RIDES IN THE EVENT and
 * therefore lives in main's replay buffer for the whole session. At this size a
 * preview is a few KB; the image it stands for is measured in megabytes, which
 * is why the full payload is stripped out of that event.
 */
const THUMBNAIL_MAX_EDGE = 320;
/** JPEG here, not PNG: this is a thumbnail to recognise, not text to read. */
const THUMBNAIL_QUALITY = 0.7;

/** A small preview data URL, or undefined if the canvas won't cooperate. */
export function makeThumbnail(bitmap: ImageBitmap): string | undefined {
	try {
		const factor = scaleFactor(bitmap.width, bitmap.height, THUMBNAIL_MAX_EDGE);
		const width = Math.max(1, Math.round(bitmap.width * factor));
		const height = Math.max(1, Math.round(bitmap.height * factor));
		const canvas = document.createElement("canvas");
		canvas.width = width;
		canvas.height = height;
		const context = canvas.getContext("2d");
		if (!context) return undefined;
		context.drawImage(bitmap, 0, 0, width, height);
		return canvas.toDataURL("image/jpeg", THUMBNAIL_QUALITY);
	} catch {
		// A preview is a nicety; failing to make one must not fail the send.
		return undefined;
	}
}

/** Every image among a DataTransfer's files, in order. */
export function imageFiles(list: FileList | null | undefined): File[] {
	if (!list) return [];
	return Array.from(list).filter((file) => file.type.startsWith("image/"));
}
