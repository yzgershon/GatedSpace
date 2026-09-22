import { FitAddon } from "@xterm/addon-fit";
import type { ProgressAddon } from "@xterm/addon-progress";
import type { SearchAddon } from "@xterm/addon-search";
import { SerializeAddon } from "@xterm/addon-serialize";
import { Terminal as XTerm } from "@xterm/xterm";
import { DEFAULT_TERMINAL_SCROLLBACK } from "shared/constants";
import {
	applyTerminalFontFamilyCssVariable,
	type TerminalAppearance,
} from "./appearance";
import { attachCopyOnSelect } from "./copy-on-select";
import {
	isCopyOnSelectEnabled,
	refreshCopyOnSelectSetting,
} from "./copy-on-select-setting";
import { scheduleFontSettleRefit } from "./font-settle";
import { installTerminalMouseCoordinates } from "./mouse-coordinates";
import {
	cancelParserIdleWork,
	createParserIdleGate,
	type ParserIdleGate,
	runWhenParserIdle,
	wrapWrite,
} from "./parser-idle-gate";
import { loadAddons } from "./terminal-addons";
import { saveClipboardImageToTemp } from "./terminal-clipboard-image-io";
import { installImagePasteHandler } from "./terminal-image-paste";
import { installTerminalKeyEventHandler } from "./terminal-key-event-handler";
import { getTerminalParkingContainer } from "./terminal-parking";

const SERIALIZE_SCROLLBACK = 1000;
const STORAGE_KEY_PREFIX = "terminal-buffer:";
const DIMS_KEY_PREFIX = "terminal-dims:";
/**
 * The geometry a terminal is born with, before it has been measured.
 *
 * Exported because the SESSION has to be created with the same numbers. The pty
 * is spawned by host-service and starts printing immediately; the client only
 * corrects the size once the socket reports `attached`, which is several round
 * trips later. Anything the shell prints in that window — a PowerShell prompt,
 * Codex's welcome box, Claude Code's banner — is laid out at whatever size the
 * pty was given, and then reflowed when the correction lands. Give the two
 * sides different numbers and that reflow moves output out of view.
 */
export const DEFAULT_COLS = 120;
export const DEFAULT_ROWS = 32;
const RESIZE_DEBOUNCE_MS = 75;

export interface TerminalRuntime {
	terminalId: string;
	terminal: XTerm;
	fitAddon: FitAddon;
	serializeAddon: SerializeAddon;
	searchAddon: SearchAddon | null;
	progressAddon: ProgressAddon | null;
	wrapper: HTMLDivElement;
	container: HTMLDivElement | null;
	onResize: (() => void) | undefined;
	gate: ParserIdleGate;
	resizeObserver: ResizeObserver | null;
	_disposeResizeObserver: (() => void) | null;
	_disposeGeometryReconcile: (() => void) | null;
	/**
	 * Whether a fit has ever succeeded against a visible container.
	 *
	 * Until it has, `lastCols`/`lastRows` are the geometry this terminal was
	 * BORN with, not a measurement — and persisting those is what turns one
	 * mismatched pane into a permanent one (see `persistDimensions`).
	 */
	hasFitted: boolean;
	lastCols: number;
	lastRows: number;
	_disposeAddons: (() => void) | null;
	/** Clears the glyph atlas and redraws. See LoadAddonsResult.forceRepaint. */
	_forceRepaint: (() => void) | null;
	_disposeImagePasteFallback: (() => void) | null;
	_disposeCopyOnSelect: (() => void) | null;
	_disposeMouseCoordinates: (() => void) | null;
}

function createTerminal(
	cols: number,
	rows: number,
	appearance: TerminalAppearance,
): {
	terminal: XTerm;
	fitAddon: FitAddon;
	serializeAddon: SerializeAddon;
} {
	const fitAddon = new FitAddon();
	const serializeAddon = new SerializeAddon();
	const terminal = new XTerm({
		cols,
		rows,
		cursorBlink: false,
		fontFamily: appearance.fontFamily,
		fontSize: appearance.fontSize,
		theme: appearance.theme,
		allowProposedApi: true,
		scrollback: DEFAULT_TERMINAL_SCROLLBACK,
		macOptionIsMeta: false,
		cursorStyle: "block",
		cursorInactiveStyle: "outline",
		// Move a few whole character rows per wheel notch.
		scrollSensitivity: 3,
		// TUI redraws move the cursor and viewport together. Animating only the
		// viewport leaves the caret at a different row during every redraw.
		smoothScrollDuration: 0,
		vtExtensions: { kittyKeyboard: true },
		scrollbar: { showScrollbar: false },
	});
	terminal.loadAddon(fitAddon);
	terminal.loadAddon(serializeAddon);
	return { terminal, fitAddon, serializeAddon };
}

function persistBuffer(terminalId: string, serializeAddon: SerializeAddon) {
	try {
		const data = serializeAddon.serialize({ scrollback: SERIALIZE_SCROLLBACK });
		localStorage.setItem(`${STORAGE_KEY_PREFIX}${terminalId}`, data);
	} catch {}
}

function restoreBuffer(terminalId: string, terminal: XTerm) {
	try {
		const data = localStorage.getItem(`${STORAGE_KEY_PREFIX}${terminalId}`);
		if (data) terminal.write(data);
	} catch {}
}

function clearPersistedBuffer(terminalId: string) {
	try {
		localStorage.removeItem(`${STORAGE_KEY_PREFIX}${terminalId}`);
	} catch {}
}

/**
 * A terminal is never 0 columns wide, so refuse to record that it was.
 *
 * This is the ratchet that made the blank terminal permanent. xterm measures
 * its character cell once, in `open()`, and measuring before the element has
 * layout yields 0x0 — the original bug. The 0x0 geometry was then WRITTEN HERE
 * on unmount, read back by `loadSavedDimensions` on the next mount (which only
 * checked `typeof === "number"`, and 0 is a number), and used to build a 0x0
 * terminal, which painted nothing and persisted 0x0 again.
 *
 * So every later fix to the measurement looked like it had done nothing: the
 * pane was no longer measuring wrong, it was replaying a wrong measurement
 * saved weeks earlier. It lives in localStorage, i.e. per userData, which is
 * why a fresh dev instance shows a working terminal on the same build where
 * the installed app shows a black one.
 */
function isUsableDimension(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * Save the geometry only if it was ever MEASURED.
 *
 * `lastCols`/`lastRows` start as the birth geometry and are only replaced by a
 * successful fit. Writing them back regardless is a ratchet: a terminal whose
 * fit was swallowed carries its predecessor's size into storage, is reborn at
 * that size on the next mount, and writes it out again — so one mismatched pane
 * becomes a permanently mismatched terminal id that survives restarts. Leaving
 * the stored value untouched keeps the last real measurement instead.
 */
function persistFittedDimensions(runtime: TerminalRuntime) {
	if (!runtime.hasFitted) return;
	persistDimensions(runtime.terminalId, runtime.lastCols, runtime.lastRows);
}

function persistDimensions(terminalId: string, cols: number, rows: number) {
	if (!isUsableDimension(cols) || !isUsableDimension(rows)) return;
	try {
		localStorage.setItem(
			`${DIMS_KEY_PREFIX}${terminalId}`,
			JSON.stringify({ cols, rows }),
		);
	} catch {}
}

function loadSavedDimensions(
	terminalId: string,
): { cols: number; rows: number } | null {
	try {
		const raw = localStorage.getItem(`${DIMS_KEY_PREFIX}${terminalId}`);
		if (!raw) return null;
		const parsed = JSON.parse(raw);
		if (isUsableDimension(parsed.cols) && isUsableDimension(parsed.rows)) {
			return { cols: parsed.cols, rows: parsed.rows };
		}
		/*
		 * A stored 0x0 (or NaN, or negative) is poison, not data. Dropping it
		 * falls through to DEFAULT_COLS/DEFAULT_ROWS and the pane paints again,
		 * so an app already carrying a bad value repairs itself on next launch
		 * with nothing for the user to clear.
		 */
		clearPersistedDimensions(terminalId);
		return null;
	} catch {
		return null;
	}
}

function clearPersistedDimensions(terminalId: string) {
	try {
		localStorage.removeItem(`${DIMS_KEY_PREFIX}${terminalId}`);
	} catch {}
}

/**
 * The geometry a terminal id will be born with on the next mount.
 *
 * Exported so the PTY can be spawned at the same numbers. `createRuntime` has
 * always preferred the saved dims over the defaults, but the launchers passed
 * the bare `DEFAULT_COLS`/`DEFAULT_ROWS` constants — so for exactly the case
 * that matters, a terminal id rehydrated from a persisted pane layout, the two
 * ends were born DIFFERENT and the shell's first output was laid out at a size
 * the renderer never had. That reflow is what pushed Codex's update prompt off
 * the top of a freshly opened pane.
 */
export function getInitialDimensions(terminalId: string): {
	cols: number;
	rows: number;
} {
	return (
		loadSavedDimensions(terminalId) ?? {
			cols: DEFAULT_COLS,
			rows: DEFAULT_ROWS,
		}
	);
}

function hostIsVisible(container: HTMLDivElement | null): boolean {
	if (!container) return false;
	return container.clientWidth > 0 && container.clientHeight > 0;
}

/**
 * One-shot diagnostics for the blank terminal.
 *
 * Every documented fix for this is already in the shipped build, dev runs the
 * same code and paints correctly, and every hypothesis checkable from outside
 * the app has been eliminated: it is not per-terminal state (a brand new pane
 * is blank too), not the shell (dev runs the same powershell.exe), not the
 * host-service start race (blank after waiting for it), and not a poisoned
 * saved geometry (the stored value was read and is valid).
 *
 * What is left is a runtime difference between packaged and dev that cannot be
 * seen from the outside, so the next build has to come back with numbers
 * instead of another theory. These are the four that decide it:
 *
 *  - `cell` 0x0  → the measurement is still wrong, and `remeasureCharSize` is
 *    not reaching xterm's private CharSizeService in the packaged bundle.
 *  - `cell` sane but `container` 0x0 → layout, not measurement.
 *  - both sane but `cols/rows` tiny or unchanged → `fit()` is the problem.
 *  - everything sane and still blank → it is the renderer/WebGL surface.
 *
 * Capped per terminal so a resize storm cannot flood the log.
 */
const diagCounts = new Map<string, number>();
const DIAG_LIMIT = 4;

function logTerminalDiagnostics(
	tag: string,
	terminalId: string,
	terminal: XTerm,
	container: HTMLElement | null,
): void {
	const seen = diagCounts.get(terminalId) ?? 0;
	if (seen >= DIAG_LIMIT) return;
	diagCounts.set(terminalId, seen + 1);

	try {
		const charSize = (
			terminal as unknown as {
				_core?: {
					_charSizeService?: {
						width?: number;
						height?: number;
						hasValidSize?: boolean;
					};
				};
			}
		)._core?._charSizeService;
		const rect = container
			? { w: container.clientWidth, h: container.clientHeight }
			: null;
		console.log(
			`[terminal-diag] ${tag} id=${terminalId.slice(0, 8)}` +
				` cell=${charSize?.width ?? "?"}x${charSize?.height ?? "?"}` +
				` valid=${charSize?.hasValidSize ?? "?"}` +
				` grid=${terminal.cols}x${terminal.rows}` +
				` container=${rect ? `${rect.w}x${rect.h}` : "none"}` +
				` dpr=${typeof devicePixelRatio === "number" ? devicePixelRatio : "?"}`,
		);
	} catch (error) {
		console.log(`[terminal-diag] ${tag} failed to read internals:`, error);
	}
}

/**
 * Reaches into xterm's CharSizeService, which is not on the public API. Same
 * justification as the mode tracker's use of private internals: @xterm/xterm
 * and @xterm/headless share this engine and the shape is stable.
 */
type CharSizeInternals = {
	_core?: { _charSizeService?: { measure(): void } };
};

/**
 * Force xterm to re-measure its cell size.
 *
 * xterm measures the cell EXACTLY ONCE, inside `open()`, by laying out a probe
 * glyph — and then never again unless a font *option* changes. Two things
 * routinely make that single measurement wrong:
 *
 *  1. `open()` ran before the element had layout, so the probe measured 0x0.
 *  2. `open()` ran before the configured font finished loading, so the probe
 *     measured a fallback face (see font-settle.ts, whose header notes the
 *     result "only repairs on the next resize" — this is that repair).
 *
 * **`fit()` is not a re-measure.** `FitAddon.proposeDimensions()` reads the
 * cached dimensions and returns undefined when the cell is 0x0, so a terminal
 * that measured badly can never fit its way out: no `resize()` means the
 * renderer's `handleResize` never runs, and `handleResize` is the only thing
 * that rebuilds the drawing surface. A full refresh paints into the degenerate
 * surface and shows nothing, which is why a blank pane stayed blank while the
 * session behind it was healthy, and why dragging a split — a real container
 * resize — made the content appear correctly.
 *
 * Cheap (one probe layout) and idempotent, and every caller is already
 * debounced or one-shot, so this is not on a hot path.
 */
function remeasureCharSize(terminal: XTerm): void {
	try {
		(
			terminal as unknown as CharSizeInternals
		)._core?._charSizeService?.measure();
	} catch {
		// Private surface — a future xterm may rename it. Falling back to the
		// stale measurement is exactly the old behaviour, never worse.
	}
}

function measureAndResize(
	runtime: TerminalRuntime,
	onResize = runtime.onResize,
): void {
	if (!hostIsVisible(runtime.container)) return;
	const { terminal } = runtime;

	runWhenParserIdle(runtime.gate, () => {
		if (!hostIsVisible(runtime.container)) return;

		const buffer = terminal.buffer.active;
		const wasPinnedToBottom = buffer.viewportY >= buffer.baseY;
		const savedViewportY = buffer.viewportY;
		const prevCols = terminal.cols;
		const prevRows = terminal.rows;

		// Re-measure BEFORE fitting. The container has real layout by the time
		// this runs, so this is the point where a measurement taken too early
		// (detached element, or an unloaded font) gets corrected — and fit()
		// silently does nothing while the cached cell size is still 0x0.
		remeasureCharSize(terminal);
		runtime.fitAddon.fit();
		runtime.hasFitted = true;
		runtime.lastCols = terminal.cols;
		runtime.lastRows = terminal.rows;
		logTerminalDiagnostics(
			"after-fit",
			runtime.terminalId,
			terminal,
			runtime.container,
		);

		if (wasPinnedToBottom) {
			terminal.scrollToBottom();
		} else {
			const targetY = Math.min(savedViewportY, terminal.buffer.active.baseY);
			if (terminal.buffer.active.viewportY !== targetY) {
				terminal.scrollToLine(targetY);
			}
		}

		terminal.refresh(0, Math.max(0, terminal.rows - 1));

		if (terminal.cols !== prevCols || terminal.rows !== prevRows) {
			// Refresh cached glyphs after the surface resize has settled. This is
			// separate from the CSS-zoom clipping fix in webgl-viewport.ts: even
			// perfectly measured cells can draw into an incorrectly sized viewport.
			requestAnimationFrame(() => {
				if (!hostIsVisible(runtime.container)) return;
				(
					runtime._forceRepaint ??
					(() => terminal.refresh(0, Math.max(0, terminal.rows - 1)))
				)();
			});
			onResize?.();
		}
	});
}

/**
 * When to re-check that the grid still matches the box, after an attach.
 *
 * The idle gate's deadline is 250ms, so the middle check lands after a fit that
 * had to wait one out, and the last one covers a font settle (2s cap) landing
 * late. Three checks, each one `proposeDimensions()` — a computed style read
 * and two divisions — so this is nothing next to being wrong.
 */
const GEOMETRY_RECONCILE_MS = [50, 400, 1400] as const;

/**
 * Prove the grid matches the container, rather than assuming the fit ran.
 *
 * A `fit()` that never happened is invisible: the terminal paints, the pty is
 * told the same wrong numbers by the `attached` handler, and both ends agree on
 * a grid too wide and too tall for the box — so every line loses its right-hand
 * end and rows fall off the bottom, with nothing left to trigger a correction.
 * The ResizeObserver only fires on a CHANGE, and the container was already its
 * final size. That is why dragging a split repaired it and nothing else did.
 *
 * `proposeDimensions()` is the same arithmetic `fit()` uses, so a disagreement
 * with the live grid is exactly the condition that needs another fit — whatever
 * swallowed the first one.
 *
 * The last check reports the geometry to the pty UNCONDITIONALLY. Everything
 * else here is change-triggered, and "the two ends drifted apart" is precisely
 * the case a change-triggered path cannot see.
 */
function scheduleGeometryReconcile(
	runtime: TerminalRuntime,
	onResize?: () => void,
): () => void {
	const timers = GEOMETRY_RECONCILE_MS.map((delay, index) =>
		setTimeout(() => {
			if (!hostIsVisible(runtime.container)) return;
			const proposed = runtime.fitAddon.proposeDimensions();
			if (
				proposed &&
				(proposed.cols !== runtime.terminal.cols ||
					proposed.rows !== runtime.terminal.rows)
			) {
				measureAndResize(runtime, onResize);
				return;
			}
			if (index === GEOMETRY_RECONCILE_MS.length - 1) onResize?.();
		}, delay),
	);
	return () => {
		for (const timer of timers) clearTimeout(timer);
	};
}

function createResizeScheduler(
	runtime: TerminalRuntime,
	onResize?: () => void,
): {
	observe: ResizeObserverCallback;
	dispose: () => void;
} {
	let timeoutId: ReturnType<typeof setTimeout> | null = null;

	const dispose = () => {
		if (timeoutId !== null) {
			clearTimeout(timeoutId);
			timeoutId = null;
		}
	};

	const run = () => {
		timeoutId = null;
		measureAndResize(runtime, onResize);
	};

	const observe: ResizeObserverCallback = (entries) => {
		if (
			entries.some(
				(entry) =>
					entry.contentRect.width <= 0 || entry.contentRect.height <= 0,
			)
		) {
			dispose();
			return;
		}
		dispose();
		timeoutId = setTimeout(run, RESIZE_DEBOUNCE_MS);
	};

	return { observe, dispose };
}

export function createRuntime(
	terminalId: string,
	appearance: TerminalAppearance,
	options: { initialBuffer?: string; renderer?: "webgl" | "dom" } = {},
): TerminalRuntime {
	const { cols, rows } = getInitialDimensions(terminalId);

	const { terminal, fitAddon, serializeAddon } = createTerminal(
		cols,
		rows,
		appearance,
	);

	const gate = createParserIdleGate();
	terminal.write = wrapWrite(gate, terminal.write.bind(terminal));

	const wrapper = document.createElement("div");
	wrapper.style.width = "100%";
	wrapper.style.height = "100%";
	applyTerminalFontFamilyCssVariable(wrapper, appearance.fontFamily);
	// Park BEFORE open(). xterm measures its cell size during open() by laying
	// out a probe glyph, and a wrapper that is in no document has no layout — so
	// the measurement comes back 0x0 and stays there, because nothing re-measures
	// until a font option actually changes. Two things then break quietly:
	// FitAddon's proposeDimensions() bails on a zero cell size, so the first
	// fit() is a no-op and the terminal keeps its birth geometry; and the WebGL
	// addon, which attaches a frame later, builds its drawing surface from those
	// same dimensions. The buffer fills up correctly and nothing paints it.
	//
	// That asymmetry is the reported bug: agents repaint constantly and recover
	// on the first re-measure (font settle, DPR change, the repaint watchdog),
	// while a plain shell prints its prompt exactly once and has nothing left to
	// redraw it with — so the pane stays blank for good.
	//
	// The parking container is `100vw x 100vh` at `-9999px` for exactly this
	// reason: attached and measurable, never visible. attachToContainer()
	// re-parents the wrapper out of it, detachFromContainer() puts it back.
	getTerminalParkingContainer().appendChild(wrapper);
	terminal.open(wrapper);
	const disposeMouseCoordinates = installTerminalMouseCoordinates(terminal);

	installTerminalKeyEventHandler(terminal);

	// Activate Unicode 11 widths (inside loadAddons) before restoring the buffer,
	// else CJK/emoji/ZWJ widths get baked wrong into the replay. (#3572)
	const addonsResult = loadAddons(
		terminal,
		() => measureAndResize(runtime),
		options.renderer,
	);
	logTerminalDiagnostics("after-open", terminalId, terminal, wrapper);
	if (options.initialBuffer !== undefined) {
		terminal.write(options.initialBuffer);
	} else {
		restoreBuffer(terminalId, terminal);
	}

	const disposeImagePasteFallback = installImagePasteHandler(
		wrapper,
		terminal,
		saveClipboardImageToTemp,
	);

	// Kick a refresh of the cached setting. There is a theoretical race — a
	// selection made before this resolves reads the previous value — but the
	// default is OFF, and selecting text within milliseconds of a terminal
	// appearing is not a thing anyone does. Erring toward not-copying is the
	// safe side of that race anyway.
	void refreshCopyOnSelectSetting();

	// Reads the setting on every selection rather than capturing it here, so
	// toggling it applies to terminals that are already open.
	const disposeCopyOnSelect = attachCopyOnSelect({
		terminal,
		element: wrapper,
		writeText: (text) => {
			void navigator.clipboard.writeText(text).catch(() => {});
		},
		isEnabled: isCopyOnSelectEnabled,
	});

	const runtime: TerminalRuntime = {
		terminalId,
		terminal,
		fitAddon,
		serializeAddon,
		searchAddon: addonsResult.searchAddon,
		progressAddon: addonsResult.progressAddon,
		wrapper,
		container: null,
		onResize: undefined,
		gate,
		resizeObserver: null,
		_disposeResizeObserver: null,
		_disposeGeometryReconcile: null,
		hasFitted: false,
		lastCols: cols,
		lastRows: rows,
		_disposeAddons: addonsResult.dispose,
		_forceRepaint: addonsResult.forceRepaint,
		_disposeImagePasteFallback: disposeImagePasteFallback,
		_disposeCopyOnSelect: disposeCopyOnSelect,
		_disposeMouseCoordinates: disposeMouseCoordinates,
	};
	return runtime;
}

export function attachToContainer(
	runtime: TerminalRuntime,
	container: HTMLDivElement,
	onResize?: () => void,
	options: { focus?: boolean } = {},
) {
	runtime.onResize = onResize;
	// If we're already attached to this exact container, do nothing. Prevents
	// redundant refresh/fit from transient remounts during provider key
	// churn — VSCode setVisible() is idempotent for the same host element.
	const sameContainer =
		runtime.container === container &&
		runtime.wrapper.parentElement === container;
	if (sameContainer && runtime.resizeObserver) {
		return;
	}

	runtime.container = container;
	container.appendChild(runtime.wrapper);
	measureAndResize(runtime, onResize);
	scheduleFontSettleRefit(
		runtime.terminal,
		() => hostIsVisible(runtime.container),
		() => measureAndResize(runtime, onResize),
	);

	runtime._disposeResizeObserver?.();
	runtime._disposeResizeObserver = null;
	runtime.resizeObserver?.disconnect();
	const scheduler = createResizeScheduler(runtime, onResize);
	const observer = new ResizeObserver(scheduler.observe);
	observer.observe(container);
	runtime.resizeObserver = observer;
	runtime._disposeResizeObserver = scheduler.dispose;

	runtime._disposeGeometryReconcile?.();
	runtime._disposeGeometryReconcile = scheduleGeometryReconcile(
		runtime,
		onResize,
	);

	if (options.focus !== false) {
		runtime.terminal.focus();
	}
}

export function detachFromContainer(runtime: TerminalRuntime) {
	persistBuffer(runtime.terminalId, runtime.serializeAddon);
	persistFittedDimensions(runtime);
	runtime._disposeGeometryReconcile?.();
	runtime._disposeGeometryReconcile = null;
	runtime._disposeResizeObserver?.();
	runtime._disposeResizeObserver = null;
	runtime.resizeObserver?.disconnect();
	runtime.resizeObserver = null;
	cancelParserIdleWork(runtime.gate);
	// Park instead of .remove() so xterm survives the React unmount —
	// see getTerminalParkingContainer.
	getTerminalParkingContainer().appendChild(runtime.wrapper);
	runtime.container = null;
	runtime.onResize = undefined;
}

export function updateRuntimeAppearance(
	runtime: TerminalRuntime,
	appearance: TerminalAppearance,
	onResize?: () => void,
) {
	const { terminal } = runtime;
	terminal.options.theme = appearance.theme;

	const fontChanged =
		terminal.options.fontFamily !== appearance.fontFamily ||
		terminal.options.fontSize !== appearance.fontSize;

	if (fontChanged) {
		applyTerminalFontFamilyCssVariable(runtime.wrapper, appearance.fontFamily);
		terminal.options.fontFamily = appearance.fontFamily;
		terminal.options.fontSize = appearance.fontSize;
		measureAndResize(runtime, onResize);
		// The freshly-selected font may still be loading — schedule a follow-up
		// refit once it resolves so dimensions track the rendered glyphs.
		scheduleFontSettleRefit(
			runtime.terminal,
			() => hostIsVisible(runtime.container),
			() => measureAndResize(runtime, onResize),
		);
	}
}

export function disposeRuntime(
	runtime: TerminalRuntime,
	options: { clearPersistedState?: boolean } = {},
) {
	const clearPersistedState = options.clearPersistedState ?? true;
	if (!clearPersistedState) {
		persistBuffer(runtime.terminalId, runtime.serializeAddon);
		persistFittedDimensions(runtime);
	}
	runtime._disposeGeometryReconcile?.();
	runtime._disposeGeometryReconcile = null;
	runtime._disposeImagePasteFallback?.();
	runtime._disposeImagePasteFallback = null;
	runtime._disposeCopyOnSelect?.();
	runtime._disposeCopyOnSelect = null;
	runtime._disposeMouseCoordinates?.();
	runtime._disposeMouseCoordinates = null;
	runtime._disposeAddons?.();
	runtime._disposeAddons = null;
	runtime._disposeResizeObserver?.();
	runtime._disposeResizeObserver = null;
	runtime.resizeObserver?.disconnect();
	runtime.resizeObserver = null;
	cancelParserIdleWork(runtime.gate);
	runtime.container = null;
	runtime.onResize = undefined;
	runtime.wrapper.remove();
	runtime.terminal.dispose();
	if (clearPersistedState) {
		clearPersistedBuffer(runtime.terminalId);
		clearPersistedDimensions(runtime.terminalId);
	}
}
