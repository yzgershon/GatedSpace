/**
 * A transparent 1×1 image, used to suppress the browser's default drag preview.
 *
 * Chromium's default preview is a snapshot of the dragged element. On a dark
 * tab or pane header that snapshot renders as a black rectangle stuck to the
 * cursor — the dragged item already dims and the drop indicator already shows
 * where it will land, so the snapshot contributes nothing but the artefact.
 *
 * This is what `react-dnd-html5-backend`'s `getEmptyImage` returns, reimplemented
 * here so this package does not take a dependency on the backend. It only
 * consumes the react-dnd core, and which backend the host app installs is the
 * host app's business.
 *
 * Cached: the image must still be alive when the drag starts, and a fresh
 * `Image` per call risks being collected before the browser reads it.
 */
let cached: HTMLImageElement | null = null;

const TRANSPARENT_PIXEL =
	"data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

export function getEmptyDragImage(): HTMLImageElement {
	if (!cached) {
		cached = new Image();
		cached.src = TRANSPARENT_PIXEL;
	}
	return cached;
}
