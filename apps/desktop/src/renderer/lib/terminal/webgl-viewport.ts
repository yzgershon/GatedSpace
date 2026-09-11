import type { WebglAddon } from "@xterm/addon-webgl";

interface WebglRenderer {
	_gl: Pick<
		WebGL2RenderingContext,
		"drawingBufferWidth" | "drawingBufferHeight" | "viewport"
	>;
	renderRows(start: number, end: number): void;
}

/**
 * Compatibility fix for @xterm/addon-webgl 0.20.0-beta.219.
 *
 * Its device-pixel ResizeObserver resizes the canvas backing buffer under CSS
 * zoom, but GlyphRenderer.handleResize sets the GL viewport from the unzoomed
 * cell grid. At zoom 0.85 a correctly fitted 1800x1190 grid draws into a
 * 1530x1012 buffer with the old viewport: the top rows and right columns vanish.
 * A shell with only a prompt looks completely blank. Re-fitting or refreshing
 * the atlas cannot correct the GL viewport.
 *
 * Match the viewport to the actual buffer BEFORE every draw, including the
 * synchronous redraw in xterm's ResizeObserver. Keep the logical cell metrics
 * and shader uniforms unchanged: they normalize glyphs within the grid.
 * This also covers pane reparenting, DPR changes and context restoration.
 *
 * The addon exposes no before-render hook. Keep the private surface here,
 * validate it at activation, and fall back to the DOM renderer if it changes.
 * The Electron terminal smoke test exercises this against the shipped addon.
 */
export function installWebglViewportSync(addon: WebglAddon): () => void {
	const renderer = (addon as unknown as { _renderer?: WebglRenderer })
		._renderer;
	if (
		!renderer ||
		typeof renderer.renderRows !== "function" ||
		typeof renderer._gl?.viewport !== "function" ||
		typeof renderer._gl.drawingBufferWidth !== "number" ||
		typeof renderer._gl.drawingBufferHeight !== "number"
	) {
		throw new Error("Unsupported xterm WebGL renderer viewport interface");
	}

	const renderRows = renderer.renderRows;
	const synchronizedRenderRows = function (
		this: WebglRenderer,
		start: number,
		end: number,
	) {
		const gl = this._gl;
		gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
		renderRows.call(this, start, end);
	};
	renderer.renderRows = synchronizedRenderRows;
	return () => {
		if (renderer.renderRows === synchronizedRenderRows) {
			renderer.renderRows = renderRows;
		}
	};
}
