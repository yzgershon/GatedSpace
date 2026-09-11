/**
 * Catching `/swap` on its way into a terminal.
 *
 * A session pane can intercept a slash command because GatedSpace owns its
 * composer. A terminal has no composer — keystrokes go straight down the socket
 * to a pty — so the only place `/swap` can be caught is the one choke point
 * every keystroke passes through, `terminal.onData`. This module is that check,
 * kept out of the transport so it can be tested without a WebSocket.
 *
 * **It fails towards doing nothing.** Any input that is not a plain printable
 * character or a backspace resets the buffer — arrow keys, Ctrl-C, an escape
 * sequence, a paste with a newline in the middle. A reset that should not have
 * happened costs nothing: `/swap` is typed through to the shell, which says it
 * cannot find the command, and the user types it again. Getting it wrong the
 * other way would mean swallowing a line somebody meant to run.
 *
 * On a match the Enter is NOT forwarded and the typed characters are erased
 * with DEL, which is what both a readline shell and an Ink-based TUI treat as
 * backspace. The alternative — letting the line run and printing an error over
 * it — would leave "command not found" in the scrollback of a command that did
 * work.
 */
import { parseSwapCommand } from "shared/claude-account/swap-command";

export interface SwapInterceptResult {
	/** What should actually be sent to the pty. Usually the input unchanged. */
	forward: string;
	/** Set when the line was `/swap`; the text after it, possibly empty. */
	swapQuery?: string;
}

export interface SwapInterceptState {
	/** Printable characters typed since the last newline or reset. */
	line: string;
}

export function createSwapInterceptState(): SwapInterceptState {
	return { line: "" };
}

/** DEL, repeated. What erases the echoed text in a shell and in a TUI alike. */
function erase(count: number): string {
	return "\x7f".repeat(count);
}

/**
 * Feed one chunk of terminal input through the check.
 *
 * xterm hands over one keypress at a time while typing and a whole block on
 * paste, so both shapes have to work. A chunk containing a newline is split at
 * the FIRST one: everything before it completes the current line, everything
 * after it starts the next.
 */
export function interceptSwapCommand(
	state: SwapInterceptState,
	data: string,
): SwapInterceptResult {
	const newlineIndex = data.search(/[\r\n]/);
	if (newlineIndex !== -1) {
		const head = data.slice(0, newlineIndex);
		// A pasted block only counts if the whole thing is one plain line —
		// anything else and the buffer is not a faithful copy of what is on
		// screen, so erasing by length would delete the wrong number of
		// characters.
		const candidate = isPlain(head) ? state.line + head : "";
		const swap = candidate ? parseSwapCommand(candidate) : null;
		state.line = "";
		if (swap) {
			return { forward: erase(candidate.length), swapQuery: swap.query };
		}
		return { forward: data };
	}

	if (data === "\x7f" || data === "\b") {
		state.line = state.line.slice(0, -1);
		return { forward: data };
	}

	if (isPlain(data)) {
		state.line += data;
		return { forward: data };
	}

	// An escape sequence, a control character, a chunk with a tab in it: the
	// buffer can no longer be trusted to match the line on screen.
	state.line = "";
	return { forward: data };
}

/** Printable text only: no control characters, no escapes, no tabs. */
function isPlain(text: string): boolean {
	if (text.length === 0) return true;
	for (const char of text) {
		const code = char.codePointAt(0) ?? 0;
		if (code < 0x20 || code === 0x7f) return false;
	}
	return true;
}
