import { TRPCError } from "@trpc/server";
import { del, put } from "@vercel/blob";

const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_SIZE_MB = 4.5;
/**
 * Cap for images stored inline (see the blob fallback below). Well above what
 * the desktop picker produces after it resizes to 512px, and small enough that
 * the row stays cheap to read and sync.
 */
const INLINE_MAX_BYTES = 512 * 1024;

export async function uploadImage({
	fileData,
	mimeType,
	pathname,
	existingUrl,
}: {
	fileData: string;
	mimeType: string;
	pathname: string;
	existingUrl: string | null;
}) {
	if (!ALLOWED_IMAGE_TYPES.includes(mimeType)) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Invalid image type. Only PNG, JPEG, and WebP are allowed",
		});
	}

	const base64Data = fileData.includes("base64,")
		? fileData.split("base64,")[1] || fileData
		: fileData;
	const buffer = Buffer.from(base64Data, "base64");

	const sizeInMB = buffer.length / (1024 * 1024);
	if (sizeInMB > MAX_SIZE_MB) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `File too large (${sizeInMB.toFixed(2)}MB). Maximum size is ${MAX_SIZE_MB}MB`,
		});
	}

	try {
		const blob = await put(pathname, buffer, {
			access: "public",
			contentType: mimeType,
		});

		// Only blob URLs can be deleted; an inlined image has nothing to clean up.
		if (existingUrl?.startsWith("http")) {
			void del(existingUrl).catch((error) => {
				console.warn("Failed to delete previous blob after upload", {
					existingUrl,
					error,
				});
			});
		}

		return blob.url;
	} catch (error) {
		// Blob storage is optional. A self-hosted or local stack usually has no
		// BLOB_READ_WRITE_TOKEN, and without this the upload just 500s with
		// nothing the user can do about it. Avatars and logos are small enough
		// to live inline in the column that already holds their URL, so fall
		// back to a data URL and keep the feature working offline.
		if (buffer.length > INLINE_MAX_BYTES) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: `Image is too large to store without blob storage configured (${(buffer.length / 1024).toFixed(0)}KB, limit ${INLINE_MAX_BYTES / 1024}KB). Use a smaller image.`,
			});
		}
		console.warn(
			"[upload] Blob storage unavailable, storing image inline:",
			error,
		);
		return `data:${mimeType};base64,${buffer.toString("base64")}`;
	}
}

export function generateImagePathname({
	prefix,
	mimeType,
}: {
	prefix: string;
	mimeType: string;
}) {
	const ext = mimeType.split("/")[1]?.replace("jpeg", "jpg") || "png";
	const randomId = Math.random().toString(36).substring(2, 15);
	return `${prefix}/${randomId}.${ext}`;
}
