/**
 * Publishes what kind of thing currently has keyboard focus, so an external
 * dictation tool can choose how to insert text.
 *
 * GatedVoice inserts dictated text one of two ways: clipboard + Ctrl+V, or
 * synthesized Unicode keystrokes. Neither works everywhere.
 *
 *  - A TERMINAL swallows Ctrl+V (it is a control character there, and Codex
 *    reads it as "paste image"), so terminals must be typed into.
 *  - A CONTROLLED REACT INPUT — the Claude session composer is
 *    `<textarea value={text}>` — must NOT be typed into as one fast burst.
 *    React sets `el.value` from state on every render, so a burst that lands
 *    before React has processed any change gets overwritten by a render
 *    carrying the old value, and the dictation vanishes entirely. That is the
 *    "it just didn't paste" failure. One clipboard paste is a single input
 *    event and cannot race.
 *
 * GatedVoice cannot tell these apart from the outside: both are a `<textarea>`
 * inside the same Chromium window and the same process. Win32 sees one window.
 * So this side, which does know, says so.
 *
 * Written to a file rather than served over a port: there is no handshake, no
 * auth, and nothing to leak — the payload is one enum. See
 * `main/lib/focus-surface-file.ts` for the writer.
 */
import { electronTrpcClient } from "renderer/lib/trpc-client";

export type FocusSurface = "terminal" | "text" | "other";

/**
 * xterm renders an off-screen textarea inside `.xterm` and routes real
 * keystrokes through it. Matching the container rather than that textarea's
 * own class covers the focus landing anywhere in the terminal's subtree.
 */
const TERMINAL_SELECTOR = ".xterm";

const TEXT_INPUT_TYPES = new Set([
	"text",
	"search",
	"url",
	"email",
	"tel",
	"password",
	"number",
	"",
]);

export function classifyFocusSurface(
	element: Element | null | undefined,
): FocusSurface {
	if (!element) return "other";
	// Terminal first: its helper element IS a textarea, so the text check below
	// would otherwise claim it and dictation would paste into a terminal that
	// ignores paste.
	if (element.closest(TERMINAL_SELECTOR)) return "terminal";

	if (element instanceof HTMLTextAreaElement) {
		return element.readOnly || element.disabled ? "other" : "text";
	}
	if (element instanceof HTMLInputElement) {
		if (element.readOnly || element.disabled) return "other";
		return TEXT_INPUT_TYPES.has(element.type.toLowerCase()) ? "text" : "other";
	}
	if (element instanceof HTMLElement && element.isContentEditable) {
		return "text";
	}
	return "other";
}

let published: FocusSurface | null = null;

function publish(surface: FocusSurface): void {
	// Only on CHANGE. Focus events fire constantly; rewriting the same value
	// would be a file write per keystroke in some editors.
	if (surface === published) return;
	published = surface;
	void electronTrpcClient.system.setFocusSurface
		.mutate({ surface })
		.catch(() => {
			// Dictation hinting is not worth surfacing an error over, and a
			// failure here just means GatedVoice falls back to typing.
			published = null;
		});
}

/**
 * Starts tracking. Returns a disposer.
 *
 * `focusin` rather than `focus` because focus does not bubble, and this needs
 * to see focus land anywhere in the document. Blur of the whole window
 * publishes "other" so a dictation fired while GatedSpace is in the background
 * does not act on a stale reading.
 */
export function trackFocusSurface(target: Document = document): () => void {
	const onFocusIn = () => publish(classifyFocusSurface(target.activeElement));
	const onWindowBlur = () => publish("other");

	target.addEventListener("focusin", onFocusIn, { capture: true });
	target.addEventListener("focusout", onFocusIn, { capture: true });
	window.addEventListener("blur", onWindowBlur);
	window.addEventListener("focus", onFocusIn);
	onFocusIn();

	return () => {
		target.removeEventListener("focusin", onFocusIn, { capture: true });
		target.removeEventListener("focusout", onFocusIn, { capture: true });
		window.removeEventListener("blur", onWindowBlur);
		window.removeEventListener("focus", onFocusIn);
	};
}
