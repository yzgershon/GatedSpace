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
 */

export interface ResumeClaim {
	/**
	 * The session id this key should own from now on, or null when it starts
	 * fresh (its real id arrives with init).
	 */
	claim: string | null;
	/** Set when a resume was refused: the key already holding that id. */
	blockedBy?: string;
}

export function resolveResumeClaim(
	key: string,
	resumeSessionId: string | undefined,
	owned: ReadonlyMap<string, string>,
	isLive: (key: string) => boolean,
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

	return { claim: resumeSessionId };
}
