/**
 * Shrinks a picked image down to something an avatar/logo endpoint will
 * actually accept.
 *
 * The upload API caps images at 4.5MB and only takes PNG / JPEG / WebP, and
 * the payload travels as a base64 data URL, which inflates it by a third
 * again. A photo straight off a phone or camera blows through that on its
 * own, so the upload failed at the server with nothing useful shown to the
 * user. Resizing here means the picture the user chose is the picture that
 * gets uploaded, whatever its original size.
 *
 * Anything Electron can't decode (some WebP builds, oddities) is passed
 * through untouched: the server is still the authority on what it accepts.
 */
import { nativeImage } from "electron";

/** Avatars and logos are never rendered above ~256px; 512 covers retina. */
const MAX_DIMENSION = 512;
/** Comfortably under the API's 4.5MB cap, base64 inflation included. */
const TARGET_BYTES = 1_000_000;

export interface PreparedImage {
	data: Buffer;
	mimeType: string;
}

export function prepareUploadImage(
	buffer: Buffer,
	mimeType: string,
): PreparedImage {
	const original: PreparedImage = { data: buffer, mimeType };

	let image: Electron.NativeImage;
	try {
		image = nativeImage.createFromBuffer(buffer);
	} catch {
		return original;
	}
	if (image.isEmpty()) return original;

	const { width, height } = image.getSize();
	if (!width || !height) return original;

	const oversized = Math.max(width, height) > MAX_DIMENSION;
	if (!oversized && buffer.length <= TARGET_BYTES) return original;

	const resized = oversized
		? image.resize(
				width >= height
					? { width: MAX_DIMENSION, quality: "best" }
					: { height: MAX_DIMENSION, quality: "best" },
			)
		: image;

	// PNG first so logos keep their transparency; JPEG only as the fallback
	// for images that are still too heavy losslessly (photos, mostly).
	const png = resized.toPNG();
	if (png.length > 0 && png.length <= TARGET_BYTES) {
		return { data: png, mimeType: "image/png" };
	}

	const jpeg = resized.toJPEG(85);
	if (jpeg.length > 0) return { data: jpeg, mimeType: "image/jpeg" };
	if (png.length > 0) return { data: png, mimeType: "image/png" };
	return original;
}
