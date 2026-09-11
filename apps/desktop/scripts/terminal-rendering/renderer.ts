import {
	DEFAULT_TERMINAL_FONT_FAMILY,
	type TerminalAppearance,
} from "../../src/renderer/lib/terminal/appearance";
import {
	attachToContainer,
	createRuntime,
	detachFromContainer,
	disposeRuntime,
	type TerminalRuntime,
	updateRuntimeAppearance,
} from "../../src/renderer/lib/terminal/terminal-runtime";

let runtime: TerminalRuntime;
let host: HTMLDivElement;
let reportedSize: number[];
const reportSize = () => {
	reportedSize = [runtime.terminal.cols, runtime.terminal.rows];
};
const appearance: TerminalAppearance = {
	fontFamily: DEFAULT_TERMINAL_FONT_FAMILY,
	fontSize: 14,
	background: "#151110",
	theme: { background: "#151110", foreground: "#ffffff" },
};
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const write = (data: string) =>
	new Promise<void>((resolve) => runtime.terminal.write(data, resolve));

function renderer() {
	return (
		runtime.terminal as unknown as {
			_core: {
				_renderService: {
					_renderer: { value: { _gl?: WebGL2RenderingContext } };
				};
			};
		}
	)._core._renderService._renderer.value;
}

async function paintCorners() {
	const { cols, rows } = runtime.terminal;
	await write(
		"\x1b[?25l\x1b[2J\x1b[H\x1b[41m  \x1b[0mPS C:\\Dev>" +
			`\x1b[1;${cols - 1}H\x1b[41m  ` +
			`\x1b[${rows};1H  ` +
			`\x1b[${rows};${cols - 1}H  \x1b[0m`,
	);
	await wait(120);
}

function snapshot() {
	const terminal = runtime.terminal;
	const gl = renderer()._gl;
	const dimensions = terminal.dimensions;
	if (!dimensions) throw new Error("Terminal renderer dimensions missing");
	const screen = terminal.element?.querySelector(".xterm-screen");
	if (!screen) throw new Error("Terminal screen missing");
	const rect = screen.getBoundingClientRect();
	return {
		cols: terminal.cols,
		rows: terminal.rows,
		proposed: runtime.fitAddon.proposeDimensions(),
		reportedSize,
		viewport: gl
			? Array.from(gl.getParameter(gl.VIEWPORT) as Int32Array)
			: null,
		buffer: gl ? [gl.drawingBufferWidth, gl.drawingBufferHeight] : null,
		logicalCanvas: dimensions.device.canvas,
		corners: [
			[rect.left, rect.top],
			[rect.right - (2 * rect.width) / terminal.cols, rect.top],
			[rect.left, rect.bottom - rect.height / terminal.rows],
			[
				rect.right - (2 * rect.width) / terminal.cols,
				rect.bottom - rect.height / terminal.rows,
			],
		].map(([x, y]) => ({
			x: x + rect.width / terminal.cols,
			y: y + rect.height / terminal.rows / 2,
		})),
		innerWidth,
		firstLine: terminal.buffer.active.getLine(0)?.translateToString(true),
	};
}

Object.assign(window, {
	terminalSmoke: {
		async sharedAtlas() {
			const surface = document.createElement("div");
			surface.style.cssText = "display:flex;zoom:.85";
			document.body.appendChild(surface);
			const peers: TerminalRuntime[] = [];
			try {
				for (let i = 0; i < 3; i++) {
					const container = document.createElement("div");
					container.style.cssText = "width:380px;height:260px;overflow:hidden";
					surface.appendChild(container);
					const peer = createRuntime(
						`atlas-${crypto.randomUUID()}`,
						appearance,
					);
					peers.push(peer);
					attachToContainer(peer, container);
				}
				await wait(2400);
				for (const [i, peer] of peers.entries()) {
					await new Promise<void>((resolve) =>
						peer.terminal.write(
							`\x1b[?25l\x1b[2J\x1b[H\x1b[3${i + 1}m${["alpha abcdef 123456", "BRAVO XYZ987654", "Codex Claude 1.18.6"][i]}\r\nTerminal glyphs stay readable.\x1b[0m`,
							resolve,
						),
					);
				}
				await wait(250);
				const renderers = peers.map(
					(peer) =>
						(
							peer.terminal as unknown as {
								_core: {
									_renderService: {
										_renderer: {
											value: {
												_charAtlas: object;
												_gl: WebGL2RenderingContext;
												_clearModel(clearGlyphs: boolean): void;
												renderRows(start: number, end: number): void;
											};
										};
									};
								};
							}
						)._core._renderService._renderer.value,
				);
				if (!renderers.every((r) => r._charAtlas === renderers[0]._charAtlas))
					throw Error("Fixture must share a real glyph atlas");
				const pixels = (index: number) => {
					const r = renderers[index];
					r.renderRows(0, peers[index].terminal.rows - 1);
					const gl = r._gl;
					const data = new Uint8Array(
						gl.drawingBufferWidth * gl.drawingBufferHeight * 4,
					);
					gl.readPixels(
						0,
						0,
						gl.drawingBufferWidth,
						gl.drawingBufferHeight,
						gl.RGBA,
						gl.UNSIGNED_BYTE,
						data,
					);
					return data;
				};
				const before = [pixels(1), pixels(2)];
				const toImage = (data: Uint8Array) => {
					const gl = renderers[1]._gl;
					const c = document.createElement("canvas");
					c.width = gl.drawingBufferWidth;
					c.height = gl.drawingBufferHeight;
					const context = c.getContext("2d");
					if (!context) throw Error("No capture context");
					const flipped = new Uint8ClampedArray(data.length);
					for (let row = 0; row < c.height; row++)
						flipped.set(
							data.subarray(row * c.width * 4, (row + 1) * c.width * 4),
							(c.height - row - 1) * c.width * 4,
						);
					context.putImageData(new ImageData(flipped, c.width, c.height), 0, 0);
					return c.toDataURL();
				};
				peers[0]._forceRepaint?.();
				await new Promise<void>((resolve) =>
					peers[0].terminal.write(
						"\x1b[H\x1b[35mREPOPULATE: !@#$%^&*()[]{}\x1b[0m",
						resolve,
					),
				);
				await wait(250);
				// Populate all siblings before sampling: drawing a sibling can add
				// glyphs and change the shared texture's mipmaps.
				pixels(1);
				pixels(2);
				const after = [pixels(1), pixels(2)];
				// Repacking the atlas changes mipmap sampling at fractional zoom.
				// Compare against freshly rebuilt geometry using the SAME packed
				// atlas, so this detects stale glyph coordinates, not antialiasing.
				const referenceImages: string[] = [];
				const differences: { max: number; substantial: number }[] = [];
				const changedBytes = after.map((data, index) => {
					renderers[index + 1]._clearModel(true);
					const reference = pixels(index + 1);
					referenceImages.push(toImage(reference));
					let max = 0,
						substantial = 0;
					for (let byte = 0; byte < data.length; byte++) {
						const d = Math.abs(data[byte] - reference[byte]);
						max = Math.max(max, d);
						if (d > 8) substantial++;
					}
					differences.push({ max, substantial });
					return data.reduce(
						(changed, value, byte) =>
							changed + Number(value !== reference[byte]),
						0,
					);
				});
				return {
					changedBytes,
					differences,
					referenceImages,
					beforeImages: before.map(toImage),
					afterImages: after.map(toImage),
				};
			} finally {
				for (const peer of peers) disposeRuntime(peer);
				surface.remove();
			}
		},
		async start(zoom: number) {
			if (runtime) disposeRuntime(runtime);
			document.getElementById("test-surface")?.remove();
			const surface = document.createElement("div");
			surface.id = "test-surface";
			surface.style.zoom = String(zoom);
			host = document.createElement("div");
			host.style.cssText = "width:900px;height:580px;overflow:hidden";
			surface.appendChild(host);
			document.body.appendChild(surface);
			runtime = createRuntime(`smoke-${crypto.randomUUID()}`, appearance);
			attachToContainer(runtime, host, reportSize);
			await write("PS C:\\Dev> idle shell prompt");
			await wait(2300); // Includes font settling and every attach refit.
			return snapshot();
		},
		paintCorners,
		snapshot,
		async resize() {
			host.style.width = "480px";
			host.style.height = "350px";
			await wait(400);
			await paintCorners();
		},
		async park() {
			detachFromContainer(runtime);
			await wait(120);
			const replacement = host.cloneNode(false) as HTMLDivElement;
			host.replaceWith(replacement);
			host = replacement;
			attachToContainer(runtime, host, reportSize);
			await wait(500); // No new output: cached content must return on its own.
		},
		async font() {
			updateRuntimeAppearance(runtime, { ...appearance, fontSize: 18 });
			await wait(500);
			await paintCorners();
		},
		async scale(zoom: number) {
			const surface = document.getElementById("test-surface");
			if (surface) surface.style.zoom = String(zoom);
			await wait(400); // No fit or write: canvas ResizeObserver must recover.
		},
		async alternate() {
			await write("\x1b[?1049h\x1b[?2026h");
			await paintCorners();
			await write("\x1b[?2026l");
			await wait(120);
		},
		async repaintPreservesStyle() {
			await write("\x1b[?1049l\x1b[2J\x1b[H\x1b[31mA");
			runtime._forceRepaint?.();
			await wait(100);
			await write("B");
			const buffer = runtime.terminal.buffer.active;
			const line = buffer.getLine(buffer.baseY);
			const first = line?.getCell(0)?.getFgColor();
			const second = line?.getCell(1)?.getFgColor();
			if (first !== 1 || second !== first) {
				throw new Error(
					`Repaint changed stream formatting: ${first} -> ${second}`,
				);
			}
			await write("\x1b[0m");
			await paintCorners();
		},
		async loseContext(restore: boolean) {
			const extension = renderer()._gl?.getExtension("WEBGL_lose_context");
			if (!extension)
				throw new Error("Context-loss test extension unavailable");
			extension.loseContext();
			if (restore) {
				await wait(150);
				extension.restoreContext();
				await wait(600);
			} else {
				await wait(3400);
			}
		},
	},
});
