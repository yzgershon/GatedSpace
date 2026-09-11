import { describe, expect, test } from "bun:test";
import type { WebglAddon } from "@xterm/addon-webgl";
import { installSharedWebglAtlasSync } from "./webgl-atlas";

function atlas() {
	return {
		merged: false,
		clearTexture() {},
		beginFrame() {
			const merged = this.merged;
			this.merged = false;
			return merged;
		},
	};
}
function owner(texture: ReturnType<typeof atlas>) {
	const draws: number[][] = [];
	let clears = 0;
	let redraws = 0;
	let uploads = 0;
	const renderer = {
		_terminal: { rows: 25 },
		_charAtlas: texture,
		_glyphRenderer: {
			value: {
				invalidateAtlasTextures() {
					uploads++;
				},
			},
		},
		_clearModel() {
			clears++;
		},
		_requestRedrawViewport() {
			redraws++;
		},
		renderRows(start: number, end: number) {
			// The native renderer handles the first consumer of the merge flag.
			if (this._charAtlas.beginFrame()) this._clearModel();
			draws.push([start, end]);
		},
	};
	const original = renderer.renderRows;
	const dispose = installSharedWebglAtlasSync({
		_renderer: renderer,
	} as unknown as WebglAddon);
	return {
		renderer,
		original,
		dispose,
		draws,
		stats: () => ({ clears, redraws, uploads }),
	};
}

describe("shared WebGL atlas ownership", () => {
	test("a clear invalidates idle siblings and rebuilds their whole visible grid", () => {
		const texture = atlas();
		const peers = [owner(texture), owner(texture), owner(texture)];
		const unrelated = owner(atlas());
		texture.clearTexture();
		for (const peer of peers) {
			expect(peer.stats()).toEqual({ clears: 0, redraws: 1, uploads: 1 });
			peer.renderer.renderRows(5, 5);
			expect(peer.draws).toEqual([[0, 24]]);
			expect(peer.stats().clears).toBe(1);
			peer.dispose();
		}
		expect(unrelated.stats()).toEqual({ clears: 0, redraws: 0, uploads: 0 });
		unrelated.dispose();
	});

	test("a consumed merge flag also invalidates siblings that render later", () => {
		const texture = atlas();
		const first = owner(texture),
			parked = owner(texture);
		texture.merged = true;
		first.renderer.renderRows(3, 3);
		expect(texture.merged).toBe(false);
		parked.renderer.renderRows(8, 8);
		expect(parked.draws).toEqual([[0, 24]]);
		expect(parked.stats()).toEqual({ clears: 1, redraws: 1, uploads: 1 });
		first.dispose();
		parked.dispose();
	});

	test("font or context changes leave the old atlas and adopt the new one", () => {
		const old = atlas(),
			next = atlas();
		const oldClear = old.clearTexture;
		const peer = owner(old),
			sibling = owner(next);
		peer.renderer._charAtlas = next;
		peer.renderer.renderRows(0, 24);
		expect(old.clearTexture).toBe(oldClear);
		old.clearTexture();
		expect(peer.stats().redraws).toBe(0);
		next.clearTexture();
		expect(peer.stats().redraws).toBe(1);
		expect(sibling.stats().redraws).toBe(1);
		peer.dispose();
		sibling.dispose();
	});

	test("disposal retains live siblings and restores atlas methods after the last owner", () => {
		const texture = atlas(),
			clear = texture.clearTexture,
			begin = texture.beginFrame;
		const first = owner(texture),
			last = owner(texture);
		first.dispose();
		first.dispose();
		expect(first.renderer.renderRows).toBe(first.original);
		texture.clearTexture();
		expect(first.stats().redraws).toBe(0);
		expect(last.stats().redraws).toBe(1);
		last.dispose();
		expect(texture.clearTexture).toBe(clear);
		expect(texture.beginFrame).toBe(begin);
	});

	test("incompatible addon internals are rejected for the DOM fallback", () => {
		expect(() => installSharedWebglAtlasSync({} as WebglAddon)).toThrow(
			"Unsupported xterm shared WebGL atlas interface",
		);
	});
});
