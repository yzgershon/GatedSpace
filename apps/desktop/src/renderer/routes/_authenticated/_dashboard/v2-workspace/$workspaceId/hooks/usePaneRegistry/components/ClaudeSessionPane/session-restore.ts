/**
 * Telling "this session is empty" apart from "this session hasn't loaded".
 *
 * Its own module, with no imports, deliberately: `sessionStore` reaches for the
 * tRPC client at module load, which throws outside Electron — so anything
 * living there cannot be unit tested at all. This rule is subtle enough to be
 * worth testing, so it lives where a test can reach it.
 */

/**
 * Where a pane is in loading its stored conversation.
 *
 * `null` means nobody has asked yet — the pane mounted but its effect hasn't
 * run. It is distinct from "done" on purpose: an empty timeline with nothing
 * pending is a NEW session (show the openers), while an empty timeline with a
 * resume id still to be read is an OLD session (show a skeleton). Collapsing
 * those two was why resuming a long conversation flashed "Start a Claude Code
 * session" at you first.
 */
export type SessionRestoreState = "loading" | "done" | null;

/**
 * Whether a pane should show a skeleton instead of the "start a session"
 * openers.
 *
 * The `null` case is the easy one to get wrong: `ensureSession` runs in an
 * effect, so the FIRST painted frame of a resumed pane happens while the store
 * still knows nothing about it. Treating that as "not restoring" is what
 * flashed the openers over a conversation that already had history — the same
 * bug, one frame smaller.
 */
export function isRestoringTranscript({
	restore,
	resumeSessionId,
}: {
	restore: SessionRestoreState;
	resumeSessionId: string | undefined;
}): boolean {
	if (restore === "loading") return true;
	return restore === null && resumeSessionId != null;
}
