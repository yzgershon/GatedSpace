import { describe, expect, test } from "bun:test";
import type { WebglAddon } from "@xterm/addon-webgl";
import { installWebglViewportSync } from "./webgl-viewport";

describe("WebGL viewport synchronization", () => {
	test("uses the live drawing buffer before drawing, preserving the receiver and rows", () => {
		const events: unknown[] = [];
		const renderer = {
			_gl: {
				drawingBufferWidth: 1530,
				drawingBufferHeight: 1012,
				viewport: (...args: number[]) => events.push(args),
			},
			renderRows(start: number, end: number) {
				expect(this).toBe(renderer);
				events.push({ start, end });
			},
		};
		const original = renderer.renderRows;
		const dispose = installWebglViewportSync({
			_renderer: renderer,
		} as unknown as WebglAddon);
		renderer.renderRows(0, 34);
		expect(events).toEqual([[0, 0, 1530, 1012], { start: 0, end: 34 }]);

		// CSS zoom, split resizing and context restoration can all change the
		// backing buffer without changing the logical grid dimensions.
		renderer._gl.drawingBufferWidth = 2160;
		renderer._gl.drawingBufferHeight = 1428;
		renderer.renderRows(4, 5);
		expect(events.slice(2)).toEqual([[0, 0, 2160, 1428], { start: 4, end: 5 }]);
		dispose();
		dispose();
		expect(renderer.renderRows).toBe(original);
	});

	test("rejects incompatible addon internals so activation can use the DOM fallback", () => {
		for (const addon of [
			{},
			{ _renderer: {} },
			{ _renderer: { renderRows() {}, _gl: {} } },
		]) {
			expect(() =>
				installWebglViewportSync(addon as unknown as WebglAddon),
			).toThrow("Unsupported xterm WebGL renderer viewport interface");
		}
	});
});
