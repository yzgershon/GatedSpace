import type { ITerminalOptions } from "@xterm/xterm";
import {
	DEFAULT_TERMINAL_FONT_FAMILY as SHARED_DEFAULT_TERMINAL_FONT_FAMILY,
	DEFAULT_TERMINAL_FONT_SIZE as SHARED_DEFAULT_TERMINAL_FONT_SIZE,
} from "renderer/lib/terminal/appearance";
import { DEFAULT_TERMINAL_SCROLLBACK } from "shared/constants";

// Use user's theme
export const TERMINAL_THEME: ITerminalOptions["theme"] = undefined;

// Fallback timeout for first render (in case xterm doesn't emit onRender)
export const FIRST_RENDER_RESTORE_FALLBACK_MS = 250;

// Debug logging for terminal lifecycle (enable via localStorage)
// Run in DevTools console: localStorage.setItem('SUPERSET_TERMINAL_DEBUG', '1')
export const DEBUG_TERMINAL =
	typeof localStorage !== "undefined" &&
	localStorage.getItem("SUPERSET_TERMINAL_DEBUG") === "1";

// Shared terminal font defaults are serialized as a valid CSS font-family value.
export const DEFAULT_TERMINAL_FONT_FAMILY = SHARED_DEFAULT_TERMINAL_FONT_FAMILY;

export const DEFAULT_TERMINAL_FONT_SIZE = SHARED_DEFAULT_TERMINAL_FONT_SIZE;

export const TERMINAL_OPTIONS: ITerminalOptions = {
	cursorBlink: true,
	fontSize: DEFAULT_TERMINAL_FONT_SIZE,
	fontFamily: DEFAULT_TERMINAL_FONT_FAMILY,
	theme: TERMINAL_THEME,
	allowProposedApi: true,
	scrollback: DEFAULT_TERMINAL_SCROLLBACK,
	// Allow Option+key to type special characters on international keyboards (e.g., Option+2 = @)
	macOptionIsMeta: false,
	cursorStyle: "block",
	cursorInactiveStyle: "outline",
	// Ambiguous-width glyphs (e.g. ◆ U+25C6, ⏵ U+23F5 in Claude Code's status
	// UI) occupy one cell but many fonts draw them wider, so they bleed into
	// neighboring cells and smear across redraws. Rescale them to fit.
	rescaleOverlappingGlyphs: true,
	vtExtensions: { kittyKeyboard: true },
	screenReaderMode: false,
	// xterm's fit addon permanently reserves scrollbar width from usable columns.
	// Hide the built-in scrollbar so terminal content can use the full pane width.
	scrollbar: {
		showScrollbar: false,
	},
};
