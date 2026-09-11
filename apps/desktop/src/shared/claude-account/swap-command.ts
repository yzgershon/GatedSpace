/**
 * `/swap` — the one way to change which Claude account you are running on.
 *
 * Parsing lives here, in shared, because the command is accepted from three
 * places that cannot import each other: the session composer's slash palette,
 * the terminal's keystroke stream, and the command palette. One parser means
 * `/swap amitai` behaves identically in all of them, and the rules are
 * testable without a window.
 *
 * There used to be several ways to change accounts (a submenu that set a
 * global default, an "Auto" mode that quietly resolved a different account per
 * spawn, and the phone bridge) and none of them told you whether the thing in
 * front of you had actually moved. `/swap` is the replacement: one verb, one
 * picker, and — in a session pane — a switch you can watch happen.
 */

/** A profile as the picker needs to know it. Mirrors ClaudeAccountProfile. */
export interface SwapCandidate {
	id: string;
	label: string;
	email?: string;
}

export interface ParsedSwapCommand {
	/** Text after `/swap`, trimmed. Empty means "open the picker". */
	query: string;
}

/**
 * Is this line the swap command?
 *
 * Deliberately strict about the leading slash and the word: `swap` on its own
 * is an ordinary English word someone might type into a prompt, and stealing
 * it would be worse than not having the command. Anything after the word is
 * treated as the account to pick.
 */
export function parseSwapCommand(line: string): ParsedSwapCommand | null {
	const trimmed = line.trim();
	if (!trimmed.startsWith("/")) return null;
	const match = /^\/swap(?:\s+(.*))?$/i.exec(trimmed);
	if (!match) return null;
	return { query: (match[1] ?? "").trim() };
}

/**
 * Which account does `/swap <query>` mean?
 *
 * Ordered from most to least certain, and it returns null rather than guessing
 * when two accounts match equally well — picking one at random is how you end
 * up on the wrong account believing you asked for the right one. An ambiguous
 * query falls through to the picker, which is never wrong.
 */
export function matchSwapCandidate<T extends SwapCandidate>(
	candidates: readonly T[],
	query: string,
): T | null {
	const needle = query.trim().toLowerCase();
	if (!needle) return null;

	const exact = candidates.filter(
		(c) =>
			c.id.toLowerCase() === needle ||
			c.label.toLowerCase() === needle ||
			c.email?.toLowerCase() === needle ||
			c.email?.split("@")[0]?.toLowerCase() === needle,
	);
	if (exact.length === 1) return exact[0] ?? null;
	if (exact.length > 1) return null;

	const prefixed = candidates.filter(
		(c) =>
			c.id.toLowerCase().startsWith(needle) ||
			c.label.toLowerCase().startsWith(needle),
	);
	return prefixed.length === 1 ? (prefixed[0] ?? null) : null;
}
