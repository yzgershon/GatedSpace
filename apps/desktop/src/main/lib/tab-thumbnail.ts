import type { BrowserWindow } from "electron";

/** Renderer bounds are CSS pixels; capturePage expects window device-independent pixels. */
export function thumbnailRect(
	rect: { x: number; y: number; width: number; height: number },
	zoom: number,
	size: { width: number; height: number },
) {
	const x = Math.max(0, Math.round(rect.x * zoom));
	const y = Math.max(0, Math.round(rect.y * zoom));
	const right = Math.min(size.width, Math.round((rect.x + rect.width) * zoom));
	const bottom = Math.min(
		size.height,
		Math.round((rect.y + rect.height) * zoom),
	);
	if (right - x < 8 || bottom - y < 8) return null;
	return { x, y, width: right - x, height: bottom - y };
}

export async function captureTabThumbnail(
	window: BrowserWindow | null,
	input: { x: number; y: number; width: number; height: number },
) {
	if (!window || window.isDestroyed() || window.isMinimized()) return null;
	const [width, height] = window.getContentSize();
	const rect = thumbnailRect(input, window.webContents.getZoomFactor(), {
		width,
		height,
	});
	if (!rect) return null;
	const image = await window.webContents.capturePage(rect);
	if (image.isEmpty()) return null;
	const size = image.getSize();
	const scale = Math.min(688 / size.width, 320 / size.height, 1);
	const thumbnail = image.resize({
		width: Math.max(1, Math.round(size.width * scale)),
		height: Math.max(1, Math.round(size.height * scale)),
		quality: "good",
	});
	return `data:image/jpeg;base64,${thumbnail.toJPEG(78).toString("base64")}`;
}
