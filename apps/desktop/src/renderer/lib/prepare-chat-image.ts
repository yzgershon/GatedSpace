import {
	IMAGE_LIMIT_MESSAGE,
	MAX_CHAT_IMAGE_BYTES,
} from "shared/image-attachments";

/** Keep supported images intact. Convert browser-decodable raster formats
 * before transport, since the model APIs do not accept BMP or AVIF blocks. */
export async function readChatImage(file: File, mime: string): Promise<string> {
	if (file.size > MAX_CHAT_IMAGE_BYTES)
		throw new Error(`${file.name}: ${IMAGE_LIMIT_MESSAGE}`);
	if (!["image/bmp", "image/avif"].includes(mime)) {
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => resolve(String(reader.result));
			reader.onerror = () =>
				reject(
					new Error(`Could not read ${file.name}. Try attaching it again.`),
				);
			reader.readAsDataURL(new Blob([file], { type: mime }));
		});
	}
	const bitmap = await createImageBitmap(file);
	try {
		const canvas = document.createElement("canvas");
		canvas.width = bitmap.width;
		canvas.height = bitmap.height;
		const context = canvas.getContext("2d");
		if (!context)
			throw new Error(
				`Could not decode ${file.name}. Save it as PNG or JPEG and retry.`,
			);
		context.drawImage(bitmap, 0, 0);
		const encoded = await new Promise<Blob | null>((resolve) =>
			canvas.toBlob(resolve, "image/png"),
		);
		canvas.width = canvas.height = 0;
		if (!encoded) throw new Error(`Could not encode ${file.name}.`);
		return readChatImage(
			new File([encoded], file.name, { type: "image/png" }),
			"image/png",
		);
	} finally {
		bitmap.close();
	}
}
