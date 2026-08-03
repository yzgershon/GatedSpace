// Clipboard policy for OSC 52.
//
// OSC 52 lets whatever is writing to the terminal touch the system clipboard.
// The trigger is merely *displaying* bytes, so the "author" of a sequence can
// be a file in a cloned repo that gets `cat`ed, a crafted commit message shown
// by `git log`, npm postinstall output, or an agent's tool output. None of
// those are things the user wrote.
//
// Read (`OSC 52 ; c ; ? BEL`) is the dangerous half: the addon's default
// provider answers it by calling navigator.clipboard.readText() and then
// injecting the result back into the pty *as if the user had typed it*, so
// whatever process is running scrapes the clipboard silently. Passwords and
// tokens live there. We refuse, which is also what VS Code does.
//
// Write stays enabled. It has real uses (copying from a remote session over
// SSH, tmux) and the attack it enables — replacing the clipboard so a later
// paste runs something else — needs the user to paste and press enter, rather
// than working on its own.

import type { IClipboardProvider } from "@xterm/addon-clipboard";

export class WriteOnlyClipboardProvider implements IClipboardProvider {
	/**
	 * Always empty. Returning "" reports an empty clipboard rather than
	 * erroring, so a program probing OSC 52 gets a well-formed answer and
	 * moves on instead of hanging on a reply that never arrives.
	 */
	readText(): string {
		return "";
	}

	writeText(_selection: string, data: string): Promise<void> {
		return navigator.clipboard.writeText(data);
	}
}
