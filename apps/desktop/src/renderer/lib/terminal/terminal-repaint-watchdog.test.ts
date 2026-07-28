/**
 * The failure this guards against is silent: a stale surface produces a blank
 * or blurry pane while the session behind it is fine, and nothing errors. So
 * the tests assert the triggers actually fire and that the DPR query is
 * rebuilt — a stale query would simply never fire again, which looks exactly
 * like the bug it was meant to fix.
 */
import { describe, expect, mock, test } from "bun:test";
import { attachRepaintWatchdog, dprQuery } from "./terminal-repaint-watchdog";

type Listener = () => void;

function harness(visibility: DocumentVisibilityState = "visible") {
	const winListeners = new Map<string, Set<Listener>>();
	const docListeners = new Map<string, Set<Listener>>();
	const mediaListeners = new Map<string, Set<Listener>>();
	const queries: string[] = [];

	const add =
		(map: Map<string, Set<Listener>>) => (type: string, fn: Listener) => {
			const set = map.get(type) ?? new Set();
			set.add(fn);
			map.set(type, set);
		};
	const remove =
		(map: Map<string, Set<Listener>>) => (type: string, fn: Listener) => {
			map.get(type)?.delete(fn);
		};

	const target = {
		addEventListener: add(winListeners),
		removeEventListener: remove(winListeners),
		matchMedia: (query: string) => {
			queries.push(query);
			return {
				addEventListener: add(mediaListeners),
				removeEventListener: remove(mediaListeners),
			} as unknown as MediaQueryList;
		},
	} as unknown as Window;

	const doc = {
		addEventListener: add(docListeners),
		removeEventListener: remove(docListeners),
		visibilityState: visibility,
	};

	const pending: (() => void)[] = [];
	const schedule = (fn: () => void) => {
		pending.push(fn);
		return pending.length;
	};
	const cancel = () => {
		pending.length = 0;
	};
	const runFrame = () => {
		const queued = [...pending];
		pending.length = 0;
		for (const fn of queued) fn();
	};

	const refresh = mock(() => {});
	const clearTextureAtlas = mock(() => {});
	const terminal = { rows: 24, refresh } as never;

	// Snapshot before dispatching. The DPR handler re-arms itself by removing and
	// re-adding its listener, and iterating a live Set would revisit the re-added
	// entry forever. Real EventTarget doesn't call listeners added during a
	// dispatch, so this matches the platform rather than working around it.
	const fire = (map: Map<string, Set<Listener>>, type: string) => {
		for (const fn of [...(map.get(type) ?? [])]) fn();
	};

	return {
		target,
		doc,
		terminal,
		refresh,
		clearTextureAtlas,
		queries,
		winListeners,
		docListeners,
		mediaListeners,
		fireFocus: () => fire(winListeners, "focus"),
		fireVisibility: () => fire(docListeners, "visibilitychange"),
		fireDpr: () => fire(mediaListeners, "change"),
		schedule,
		cancel,
		runFrame,
	};
}

describe("dprQuery", () => {
	test("builds a query that is true only at the current ratio", () => {
		expect(dprQuery(2)).toBe("(resolution: 2dppx)");
		expect(dprQuery(1.5)).toBe("(resolution: 1.5dppx)");
	});
});

describe("attachRepaintWatchdog", () => {
	test("repaints when the window regains focus", () => {
		const h = harness();
		attachRepaintWatchdog({
			terminal: h.terminal,
			target: h.target,
			doc: h.doc,
			schedule: h.schedule,
			cancel: h.cancel,
		});
		h.fireFocus();
		h.runFrame();
		expect(h.refresh).toHaveBeenCalledWith(0, 23);
	});

	test("repaints when the document becomes visible again", () => {
		const h = harness("visible");
		attachRepaintWatchdog({
			terminal: h.terminal,
			target: h.target,
			doc: h.doc,
			schedule: h.schedule,
			cancel: h.cancel,
		});
		h.fireVisibility();
		h.runFrame();
		expect(h.refresh).toHaveBeenCalled();
	});

	test("does NOT repaint when the document goes hidden", () => {
		const h = harness("hidden");
		attachRepaintWatchdog({
			terminal: h.terminal,
			target: h.target,
			doc: h.doc,
			schedule: h.schedule,
			cancel: h.cancel,
		});
		h.fireVisibility();
		h.runFrame();
		expect(h.refresh).not.toHaveBeenCalled();
	});

	test("a DPR change clears the glyph atlas before refreshing", () => {
		// Refreshing alone would redraw the same wrongly-scaled glyphs, which is
		// the actual blurry-text bug.
		const h = harness();
		attachRepaintWatchdog({
			terminal: h.terminal,
			target: h.target,
			doc: h.doc,
			schedule: h.schedule,
			cancel: h.cancel,
			getRenderer: () => ({ clearTextureAtlas: h.clearTextureAtlas }),
		});
		h.fireDpr();
		h.runFrame();
		expect(h.clearTextureAtlas).toHaveBeenCalled();
		expect(h.refresh).toHaveBeenCalled();
	});

	test("focus does NOT clear the atlas — only DPR changes invalidate it", () => {
		const h = harness();
		attachRepaintWatchdog({
			terminal: h.terminal,
			target: h.target,
			doc: h.doc,
			schedule: h.schedule,
			cancel: h.cancel,
			getRenderer: () => ({ clearTextureAtlas: h.clearTextureAtlas }),
		});
		h.fireFocus();
		h.runFrame();
		expect(h.clearTextureAtlas).not.toHaveBeenCalled();
		expect(h.refresh).toHaveBeenCalled();
	});

	test("the DPR query is rebuilt after a change, or it never fires again", () => {
		// `(resolution: 2dppx)` is false once you're at 1.5. Keeping the old query
		// means the second monitor move is never noticed — indistinguishable from
		// having no watchdog at all.
		const h = harness();
		attachRepaintWatchdog({
			terminal: h.terminal,
			target: h.target,
			doc: h.doc,
			schedule: h.schedule,
			cancel: h.cancel,
		});
		expect(h.queries).toHaveLength(1);
		h.fireDpr();
		h.runFrame();
		expect(h.queries).toHaveLength(2);
	});

	test("two triggers in one frame coalesce into a single repaint", () => {
		// focus and visibilitychange routinely arrive together; two full refreshes
		// in one frame is a visible flicker.
		const h = harness();
		attachRepaintWatchdog({
			terminal: h.terminal,
			target: h.target,
			doc: h.doc,
			schedule: h.schedule,
			cancel: h.cancel,
		});
		h.fireFocus();
		h.fireVisibility();
		h.runFrame();
		expect(h.refresh).toHaveBeenCalledTimes(1);
	});

	test("disposing detaches every listener", () => {
		const h = harness();
		const dispose = attachRepaintWatchdog({
			terminal: h.terminal,
			target: h.target,
			doc: h.doc,
			schedule: h.schedule,
			cancel: h.cancel,
		});
		dispose();
		expect(h.winListeners.get("focus")?.size ?? 0).toBe(0);
		expect(h.docListeners.get("visibilitychange")?.size ?? 0).toBe(0);
		expect(h.mediaListeners.get("change")?.size ?? 0).toBe(0);
	});

	test("a repaint already queued when disposal happens is dropped", () => {
		// Must use the same scheduler seam as the others, or this passes for the
		// wrong reason: the default scheduler's callback would simply never be
		// driven by runFrame, and "not called" would prove nothing.
		const h = harness();
		const dispose = attachRepaintWatchdog({
			terminal: h.terminal,
			target: h.target,
			doc: h.doc,
			schedule: h.schedule,
			cancel: h.cancel,
		});
		h.fireFocus();
		dispose();
		h.runFrame();
		expect(h.refresh).not.toHaveBeenCalled();
	});
});
