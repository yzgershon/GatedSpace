/** Galaxy S24: 1080 x 2340 physical pixels, rendered at 3 device pixels per CSS pixel. */
export const BROWSER_PREVIEW_MODES = [
	"responsive",
	"desktop",
	"galaxy-s24",
] as const;
export type BrowserPreviewMode = (typeof BROWSER_PREVIEW_MODES)[number];
export type BrowserPreviewOrientation = "portrait" | "landscape";

export function browserPreviewSize(
	mode: BrowserPreviewMode,
	orientation: BrowserPreviewOrientation = "portrait",
) {
	if (mode === "responsive") return null;
	if (mode === "desktop") return { width: 1280, height: 800 };
	return orientation === "landscape"
		? { width: 780, height: 360 }
		: { width: 360, height: 780 };
}

export interface BrowserPreviewConfig {
	mode: BrowserPreviewMode;
	orientation: BrowserPreviewOrientation;
	scale: number;
}
