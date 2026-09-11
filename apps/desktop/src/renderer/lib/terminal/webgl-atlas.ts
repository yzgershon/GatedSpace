import type { WebglAddon } from "@xterm/addon-webgl";

interface Atlas {
	clearTexture(): void;
	beginFrame(): boolean;
}
interface Renderer {
	_terminal: { rows: number };
	_charAtlas?: Atlas;
	_clearModel(clearGlyphs: boolean): void;
	_requestRedrawViewport(): void;
	_glyphRenderer: { value?: { invalidateAtlasTextures(): void } };
	renderRows(start: number, end: number): void;
}
interface SharedAtlas {
	members: Set<Renderer>;
	restore(): void;
}
const atlases = new WeakMap<Atlas, SharedAtlas>();
const invalidated = new WeakSet<Renderer>();

/** xterm shares atlas pixels but caches glyph coordinates separately per renderer.
 * Clearing/merging that atlas must invalidate EVERY owner's coordinates, including
 * idle and parked terminals. The addon's clearTextureAtlas only resets its caller,
 * and its merge flag is consumed by the first renderer to begin a frame.
 */
function join(atlas: Atlas, renderer: Renderer): () => void {
	let shared = atlases.get(atlas);
	if (!shared) {
		const members = new Set<Renderer>();
		const clearTexture = atlas.clearTexture;
		const beginFrame = atlas.beginFrame;
		const invalidate = () => {
			for (const owner of members) {
				if (owner._charAtlas !== atlas) continue;
				invalidated.add(owner);
				owner._glyphRenderer.value?.invalidateAtlasTextures();
				owner._requestRedrawViewport();
			}
		};
		const clear = () => {
			clearTexture.call(atlas);
			invalidate();
		};
		const begin = () => {
			const changed = beginFrame.call(atlas);
			if (changed) invalidate();
			return changed;
		};
		atlas.clearTexture = clear;
		atlas.beginFrame = begin;
		shared = {
			members,
			restore() {
				if (atlas.clearTexture === clear) atlas.clearTexture = clearTexture;
				if (atlas.beginFrame === begin) atlas.beginFrame = beginFrame;
				atlases.delete(atlas);
			},
		};
		atlases.set(atlas, shared);
	}
	shared.members.add(renderer);
	const membership = shared;
	return () => {
		membership.members.delete(renderer);
		if (!membership.members.size) membership.restore();
	};
}

/** Keep the private addon surface guarded alongside webgl-viewport.ts. */
export function installSharedWebglAtlasSync(addon: WebglAddon): () => void {
	const renderer = (addon as unknown as { _renderer?: Renderer })._renderer;
	if (
		!renderer ||
		typeof renderer._terminal?.rows !== "number" ||
		typeof renderer.renderRows !== "function" ||
		typeof renderer._clearModel !== "function" ||
		typeof renderer._requestRedrawViewport !== "function" ||
		typeof renderer._glyphRenderer?.value?.invalidateAtlasTextures !==
			"function"
	) {
		throw new Error("Unsupported xterm shared WebGL atlas interface");
	}
	let current: Atlas | undefined;
	let leave: (() => void) | undefined;
	const sync = () => {
		if (renderer._charAtlas === current) return;
		leave?.();
		current = renderer._charAtlas;
		if (
			current &&
			(typeof current.clearTexture !== "function" ||
				typeof current.beginFrame !== "function")
		) {
			throw new Error("Unsupported xterm texture atlas interface");
		}
		leave = current ? join(current, renderer) : undefined;
	};
	const original = renderer.renderRows;
	const render = (start: number, end: number) => {
		sync();
		if (invalidated.delete(renderer)) {
			renderer._clearModel(true);
			start = 0;
			end = renderer._terminal.rows - 1;
		}
		original.call(renderer, start, end);
		sync();
	};
	sync();
	renderer.renderRows = render;
	let disposed = false;
	return () => {
		if (disposed) return;
		disposed = true;
		invalidated.delete(renderer);
		if (renderer.renderRows === render) renderer.renderRows = original;
		leave?.();
	};
}
