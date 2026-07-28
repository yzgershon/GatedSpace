/**
 * Copy the terminal selection to the clipboard as soon as it settles.
 *
 * The tricky part is "settles". xterm fires `onSelectionChange` on every frame
 * of a drag, so copying on each one would write to the clipboard dozens of
 * times per selection — and on Windows, where other apps watch the clipboard,
 * that is not merely wasteful. The copy therefore waits for the pointer to come
 * up (or a brief pause, for keyboard and double-click selections).
 *
 * Off by default. Replacing whatever the user had copied, every time they drag
 * across a terminal to read something, is only a good trade for people who
 * expect it.
 */

export interface CopyOnSelectTerminal {
	onSelectionChange(listener: () => void): { dispose(): void };
	getSelection(): string;
	hasSelection(): boolean;
}

export interface CopyOnSelectOptions {
	terminal: CopyOnSelectTerminal;
	/** The terminal's DOM element, for pointer state. */
	element: HTMLElement;
	/** Injected so tests don't need a real clipboard. */
	writeText: (text: string) => void;
	/** Injected so tests don't wait in real time. */
	schedule?: (fn: () => void, ms: number) => number;
	cancel?: (handle: number) => void;
	/** Read fresh on each selection, so toggling the setting takes effect live. */
	isEnabled: () => boolean;
}

/**
 * How long after the last selection change to copy, when no pointer is
 * involved. Long enough that a double-click's two events settle into one copy,
 * short enough to feel immediate.
 */
const SETTLE_MS = 120;

export function attachCopyOnSelect(options: CopyOnSelectOptions): () => void {
	const {
		terminal,
		element,
		writeText,
		isEnabled,
		schedule = (fn, ms) => window.setTimeout(fn, ms),
		cancel = (handle) => window.clearTimeout(handle),
	} = options;

	let pending: number | null = null;
	let pointerDown = false;
	let missedWhileDown = false;

	function clearPending(): void {
		if (pending === null) return;
		cancel(pending);
		pending = null;
	}

	function copyNow(): void {
		clearPending();
		if (!isEnabled()) return;
		if (!terminal.hasSelection()) return;
		const text = terminal.getSelection();
		// An empty or whitespace-only selection is almost always an accidental
		// click. Wiping the clipboard with it would be the most annoying possible
		// version of this feature.
		if (!text.trim()) return;
		writeText(text);
	}

	const onPointerDown = () => {
		pointerDown = true;
		missedWhileDown = false;
		// A new drag invalidates a copy queued by the previous selection.
		clearPending();
	};

	const onPointerUp = () => {
		pointerDown = false;
		if (!missedWhileDown) return;
		missedWhileDown = false;
		copyNow();
	};

	const subscription = terminal.onSelectionChange(() => {
		if (!isEnabled()) return;
		if (pointerDown) {
			// Mid-drag: remember that something changed and copy once, on release.
			missedWhileDown = true;
			return;
		}
		clearPending();
		pending = schedule(copyNow, SETTLE_MS);
	});

	element.addEventListener("pointerdown", onPointerDown);
	// On the window, not the element: a drag very often ends outside the
	// terminal, and a pointerup missed there would leave the copy queued
	// forever with `pointerDown` stuck true.
	window.addEventListener("pointerup", onPointerUp);

	return () => {
		clearPending();
		subscription.dispose();
		element.removeEventListener("pointerdown", onPointerDown);
		window.removeEventListener("pointerup", onPointerUp);
	};
}
