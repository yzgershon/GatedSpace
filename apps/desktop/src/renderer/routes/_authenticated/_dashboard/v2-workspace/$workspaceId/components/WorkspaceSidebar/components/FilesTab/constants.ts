/**
 * Row height (px) for the Files-tab explorer tree — drives the Pierre model's `itemHeight` and the `--trees-row-height-override`.
 * Matches the Changes-tab tree (ChangesTreeView) so list density doesn't jump when
 * switching sidebar tabs.
 */
export const FILE_EXPLORER_ROW_HEIGHT = 24;
/** Per-level indent (px) for the Files-tab explorer tree. Matches the Changes tree. */
export const FILE_EXPLORER_INDENT = 8;
/** Rows rendered beyond the viewport in the virtualized explorer tree. */
export const FILE_EXPLORER_OVERSCAN = 10;
