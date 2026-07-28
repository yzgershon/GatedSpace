/**
 * What a committed rename actually means.
 *
 * Separated from the input so the three rules that are easy to get wrong can
 * be pinned by tests rather than by clicking around.
 */
export interface RenameResolution {
	/** False when the commit should do nothing at all. */
	shouldRename: boolean;
	/** `undefined` restores the pane's derived title. */
	title?: string;
}

export function resolvePaneRename(
	draft: string,
	currentTitle: string,
): RenameResolution {
	const trimmed = draft.trim();

	// Committing a value identical to what is shown would PIN the pane to a name
	// that currently just happens to match the derived one. The pane would then
	// stop tracking whatever it goes on to run, which looks like a bug rather
	// than a rename nobody asked for.
	if (trimmed === currentTitle) return { shouldRename: false };

	// Clearing restores the derived title instead of leaving the pane blank.
	// Four terminals called "" is worse than four called "zsh", and this is the
	// only route back once a name has been set.
	if (trimmed.length === 0) return { shouldRename: true, title: undefined };

	return { shouldRename: true, title: trimmed };
}
