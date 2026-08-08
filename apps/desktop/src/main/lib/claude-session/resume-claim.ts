/**
 * Decides whether a pane may resume a given Claude session id.
 *
 * Two writers on one session id silently destroy the newer copy's transcript —
 * it has happened twice — so this is the check that has to be right.
 *
 * The subtle part is WHEN a pane owns an id. The obvious answer, "when its
 * session reports one in its init event", leaves a hole: init arrives a second
 * or two after spawn, and two panes resuming the same id inside that window
 * both see an unowned id and both proceed. Restoring a layout that holds the
 * same resume id twice, or a double click in the recent-sessions list, lands
 * squarely in that gap.
 *
 * So a pane claims the id at spawn, on intent, and init only confirms it.
 * Ownership is also scoped to keys that are actually live: a dead session's
 * leftover id must not block a legitimate resume.
 *
 * `owned` only covers panes in THIS process. ACP sessions run in the host
 * service and write to the same on-disk transcript store — verified 2026-08-05:
 * an ACP run left new files under `~/.claude/projects` alongside the ones the
 * panes write. A holder over there is invisible to `owned`, so it arrives
 * separately as `externallyHeld`.
 */

export interface ResumeClaim {
	/**
	 * The session id this key should own from now on, or null when it starts
	 * fresh (its real id arrives with init).
	 */
	claim: string | null;
	/** Set when a resume was refused: the key already holding that id. */
	blockedBy?: string;
	/**
	 * Set when the holder is outside this process (an ACP session in the host
	 * service). There is no pane key to name, and the caller's message has to
	 * differ — "already open in another pane" is wrong and sends the user
	 * hunting through their tabs for it. The remedy is the same: fork.
	 */
	blockedByExternal?: boolean;
}

export function resolveResumeClaim(
	key: string,
	resumeSessionId: string | undefined,
	owned: ReadonlyMap<string, string>,
	isLive: (key: string) => boolean,
	/**
	 * Session ids held by a LIVE writer outside this process. Offline or dead
	 * holders must not appear here, for the same reason `isLive` scopes `owned`:
	 * a leftover id would block a legitimate resume forever.
	 */
	externallyHeld: ReadonlySet<string> = new Set(),
): ResumeClaim {
	if (!resumeSessionId) {
		// Starting fresh. Explicitly claiming nothing clears any id left over
		// from a previous session on this key, which would otherwise go on
		// blocking resumes once the key is live again.
		return { claim: null };
	}

	for (const [otherKey, id] of owned) {
		if (otherKey === key) continue;
		if (id !== resumeSessionId) continue;
		if (!isLive(otherKey)) continue;
		return { claim: null, blockedBy: otherKey };
	}

	// Checked after the local loop so a pane conflict still names the pane —
	// that message is more useful than "another process has it".
	if (externallyHeld.has(resumeSessionId)) {
		return { claim: null, blockedByExternal: true };
	}

	return { claim: resumeSessionId };
}
