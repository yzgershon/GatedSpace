/**
 * Repaint a terminal when its drawing surface has gone stale underneath it.
 *
 * xterm renders to a canvas (or a WebGL surface) and assumes it stays valid.
 * Two things on Windows break that assumption without xterm ever finding out,
 * and both leave a pane looking blank, frozen, or blurry while the session
 * behind it is perfectly healthy:
 *
 *  1. **Wake and re-focus.** After the machine sleeps, or the window is
 *     occluded long enough for the compositor to discard its surface, the
 *     canvas comes back empty. Nothing writes to the terminal, so nothing
 *     triggers a redraw, and the pane stays blank until output happens to
 *     arrive.
 *
 *  2. **Device-pixel-ratio change.** Dragging the window between monitors with
 *     different scaling changes devicePixelRatio. The glyph atlas was baked at
 *     the old ratio, so text renders blurry or mis-sized until something forces
 *     the atlas to be rebuilt. With two monitors at different scales this is a
 *     daily occurrence, not an edge case.
 *
 * The fix for both is the same shape: notice, then force a repaint — and for a
 * DPR change, throw away the glyph atlas first, because refreshing alone
 * redraws the same wrongly-scaled glyphs.
 *
 * DPR is watched with a matchMedia query rather than polling, which means the
 * query has to be REBUILT after every change: `(resolution: 2dppx)` stops being
 * true once you're at 1.5, and a stale listener would never fire again.
 */
import type { Terminal as XTerm } from "@xterm/xterm";

/** Enough of the WebGL addon for what recovery needs, without importing it. */
export interface RepaintableRenderer {
	clearTextureAtlas?: () => void;
}

/** Method syntax, so a plain object is assignable (parameter bivariance). */
interface RepaintEventTarget {
	addEventListener(type: string, listener: () => void): void;
	removeEventListener(type: string, listener: () => void): void;
}

export interface RepaintWindow extends RepaintEventTarget {
	matchMedia(query: string): MediaQueryList;
}

export interface RepaintDocument extends RepaintEventTarget {
	visibilityState: DocumentVisibilityState;
}

export interface RepaintWatchdogOptions {
	terminal: XTerm;
	/**
	 * Resolved lazily: the WebGL addon is attached a frame after open and may be
	 * dropped at any point by a context loss, so a captured reference goes stale.
	 */
	getRenderer?: () => RepaintableRenderer | null;
	/**
	 * Test seam. Defaults to the real window.
	 *
	 * Declared as the minimum this needs rather than as `Pick<Window, …>`: the
	 * DOM's own signatures are overloaded per event map, so nothing hand-built
	 * can satisfy them, and a seam a test can't implement isn't a seam.
	 */
	target?: RepaintWindow;
	/** Test seam. Defaults to the real document. */
	doc?: RepaintDocument;
	/** Reported so a blank-pane report can say what triggered the recovery. */
	onRepaint?: (reason: RepaintReason) => void;
	/**
	 * Frame scheduler. Defaults to requestAnimationFrame, falling back to a
	 * timeout where there is no browser frame loop (tests, or any non-DOM host).
	 */
	schedule?: (fn: () => void) => number;
	cancel?: (handle: number) => void;
}

const defaultSchedule = (fn: () => void): number =>
	typeof requestAnimationFrame === "function"
		? requestAnimationFrame(fn)
		: (setTimeout(fn, 0) as unknown as number);

const defaultCancel = (handle: number): void => {
	if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(handle);
	else clearTimeout(handle);
};

export type RepaintReason = "focus" | "visible" | "dpr-change";

/**
 * The media query that stays true only while DPR is unchanged.
 *
 * Exported for tests: getting this wrong fails silently — the listener simply
 * never fires and blurry text is never fixed.
 */
export function dprQuery(ratio: number): string {
	return `(resolution: ${ratio}dppx)`;
}

export function attachRepaintWatchdog(
	options: RepaintWatchdogOptions,
): () => void {
	const {
		terminal,
		getRenderer,
		target = window,
		doc = document,
		onRepaint,
		schedule = defaultSchedule,
		cancel = defaultCancel,
	} = options;

	let disposed = false;
	let frame: number | null = null;
	let mediaQuery: MediaQueryList | null = null;

	const repaint = (reason: RepaintReason): void => {
		if (disposed) return;
		// Coalesce: focus and visibilitychange routinely fire together, and two
		// full refreshes in one frame is visible as a flicker.
		if (frame !== null) return;
		frame = schedule(() => {
			frame = null;
			if (disposed) return;
			try {
				if (reason === "dpr-change") {
					// Refresh alone would redraw the same wrongly-scaled glyphs.
					getRenderer?.()?.clearTextureAtlas?.();
				}
				terminal.refresh(0, terminal.rows - 1);
				onRepaint?.(reason);
			} catch {
				// A terminal disposed mid-flight is the common case here, and a
				// failed repaint must never take down the pane it was fixing.
			}
		});
	};

	const onFocus = () => repaint("focus");
	const onVisibility = () => {
		if (doc.visibilityState === "visible") repaint("visible");
	};

	// Rebuilt on every change: the previous query is false once DPR moves, so
	// keeping it would mean never hearing about the next change.
	const watchDpr = (): void => {
		if (disposed) return;
		mediaQuery?.removeEventListener("change", onDprChange);
		try {
			const ratio = typeof window !== "undefined" ? window.devicePixelRatio : 1;
			mediaQuery = target.matchMedia(dprQuery(ratio));
			mediaQuery.addEventListener("change", onDprChange);
		} catch {
			// matchMedia is always present in Electron; guard anyway so a headless
			// or test environment without it doesn't lose focus recovery too.
			mediaQuery = null;
		}
	};

	function onDprChange(): void {
		repaint("dpr-change");
		watchDpr();
	}

	target.addEventListener("focus", onFocus);
	doc.addEventListener("visibilitychange", onVisibility);
	watchDpr();

	return () => {
		disposed = true;
		if (frame !== null) cancel(frame);
		target.removeEventListener("focus", onFocus);
		doc.removeEventListener("visibilitychange", onVisibility);
		mediaQuery?.removeEventListener("change", onDprChange);
		mediaQuery = null;
	};
}
