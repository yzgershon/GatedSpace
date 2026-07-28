/**
 * v2 is the only workspace UI. This hook is now a constant.
 *
 * Upstream shipped two complete workspace UIs side by side during their v1→v2
 * migration, with this hook choosing between them per user. GatedSpace has only
 * ever used v2 — every pane, the Claude session view, the sidebar browser and
 * the whole 1.16/1.17 line of work are v2 — while v1 stayed reachable through
 * an Experimental toggle that could only ever drop someone into a different,
 * worse app missing all of it.
 *
 * Kept as a hook rather than deleted outright so the ~15 call sites do not all
 * have to change at once; they read as `true` and can be inlined as the v1 tree
 * comes out. See `useIsV2OnlyUser` below, which is now only about cohort
 * reporting and no longer decides anything.
 */

/**
 * Whether v2 is active. Always true.
 *
 * Do NOT reintroduce a false branch. Rendering v1 means rendering a UI with no
 * session pane, no browser pane and no accents, from code that is being
 * removed.
 */
export function useIsV2CloudEnabled(): boolean {
	return true;
}
