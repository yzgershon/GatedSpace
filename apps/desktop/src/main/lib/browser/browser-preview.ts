import type { WebContents } from "electron";
import {
	type BrowserPreviewConfig,
	browserPreviewSize,
} from "shared/browser-preview";

const originalUserAgents = new WeakMap<WebContents, string>();
const previewScales = new WeakMap<WebContents, number>();

/** DOM rectangles use page CSS pixels; native input uses the displayed guest surface. */
export function browserInputPoint(
	wc: WebContents,
	point: { x: number; y: number },
) {
	const scale = previewScales.get(wc) ?? wc.getZoomFactor();
	return { x: Math.round(point.x * scale), y: Math.round(point.y * scale) };
}

/** Native Chromium emulation keeps the guest's paint and hit targets in the same coordinate space. */
export function applyBrowserPreview(
	wc: WebContents,
	config: BrowserPreviewConfig,
) {
	const size = browserPreviewSize(config.mode, config.orientation);
	const originalUserAgent = originalUserAgents.get(wc) ?? wc.getUserAgent();
	originalUserAgents.set(wc, originalUserAgent);
	wc.setUserAgent(
		config.mode === "galaxy-s24"
			? `Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Mobile Safari/537.36`
			: originalUserAgent,
	);
	if (!size) {
		wc.disableDeviceEmulation();
		previewScales.delete(wc);
		return;
	}
	wc.setZoomFactor(1);
	wc.enableDeviceEmulation({
		screenPosition: config.mode === "galaxy-s24" ? "mobile" : "desktop",
		screenSize: size,
		viewPosition: { x: 0, y: 0 },
		viewSize: size,
		deviceScaleFactor: config.mode === "galaxy-s24" ? 3 : 0,
		scale: config.scale,
	});
	previewScales.set(wc, config.scale);
}
