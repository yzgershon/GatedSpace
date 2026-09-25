import {
	type BrowserPreviewMode,
	type BrowserPreviewOrientation,
	browserPreviewSize,
} from "shared/browser-preview";

export interface PreviewRect {
	left: number;
	top: number;
	width: number;
	height: number;
}

/** Work entirely in host CSS coordinates; Chromium scales the guest, never the webview element. */
export function previewLayout(
	rect: PreviewRect,
	clips: PreviewRect[],
	mode: BrowserPreviewMode,
	orientation: BrowserPreviewOrientation,
) {
	const size = browserPreviewSize(mode, orientation);
	const scale = size
		? Math.min(
				1,
				Math.max(0, rect.width) / size.width,
				Math.max(0, rect.height) / size.height,
			)
		: 1;
	const width = size ? size.width * scale : rect.width;
	const height = size ? size.height * scale : rect.height;
	const left = rect.left + (rect.width - width) / 2;
	const top = rect.top + (size ? Math.min(16, (rect.height - height) / 2) : 0);
	const clip = clips.reduce(
		(area, next) => ({
			left: Math.max(area.left, next.left),
			top: Math.max(area.top, next.top),
			right: Math.min(area.right, next.left + next.width),
			bottom: Math.min(area.bottom, next.top + next.height),
		}),
		{ left, top, right: left + width, bottom: top + height },
	);
	return {
		left,
		top,
		width,
		height,
		scale,
		visible:
			width > 1 &&
			height > 1 &&
			clip.right > clip.left &&
			clip.bottom > clip.top,
		clipPath: `inset(${Math.max(0, clip.top - top)}px ${Math.max(0, left + width - clip.right)}px ${Math.max(0, top + height - clip.bottom)}px ${Math.max(0, clip.left - left)}px)`,
	};
}
