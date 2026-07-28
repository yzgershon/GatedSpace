/**
 * Side-by-side diff for a file edit inside a session timeline.
 *
 * Renders `MultiFileDiff` directly instead of reusing the chat pane's
 * `EditToolExpandedDiff`, for two reasons. That component pulls font settings
 * through an `electronTrpc` HOOK, and hooks against that client have hijacked
 * this workspace tree's trpc context before ("No procedure found"). And it takes
 * its view mode from the Changes store, whereas a timeline edit always wants
 * split: seeing both sides at once is the whole point of showing a diff here
 * rather than a patch.
 *
 * Unchanged regions stay collapsed. Surrounding context is noise in a timeline —
 * the change IS the summary.
 */
import { MultiFileDiff } from "@pierre/diffs/react";
import {
	getDiffsTheme,
	getDiffViewerStyle,
} from "renderer/components/WorkspaceView/utils/code-theme";
import { useResolvedTheme } from "renderer/stores/theme";

/**
 * Past this much text a diff stops being worth its render cost: a Write of a
 * whole file can be hundreds of KB, and syntax-highlighting all of it stalls the
 * stream. Callers fall back to plain clamped output.
 */
export const DIFF_MAX_CHARS = 120_000;

export function SessionDiff({
	filePath,
	oldString,
	newString,
}: {
	filePath: string;
	oldString: string;
	newString: string;
}) {
	const theme = useResolvedTheme();

	// A Write has no original, so a split view spends half the pane on an empty
	// column of hatching. Unified is what that change actually looks like.
	const isPureAddition = oldString.trim().length === 0;

	return (
		<MultiFileDiff
			oldFile={{ name: filePath, contents: oldString }}
			newFile={{ name: filePath, contents: newString }}
			// Cast because these are CSS custom properties, which React types as
			// unknown on CSSProperties — the same reason getDiffViewerStyle casts.
			style={
				{
					...getDiffViewerStyle(theme, {}),
					// Smaller than the editor's, to match the reference: a diff inside a
					// conversation is being skimmed, not edited.
					"--diffs-font-size": "11.5px",
					"--diffs-line-height": "17px",
				} as React.CSSProperties
			}
			options={{
				diffStyle: isPureAddition ? "unified" : "split",
				expandUnchanged: false,
				theme: getDiffsTheme(theme),
				themeType: theme.type,
				overflow: "wrap",
				disableFileHeader: true,
				unsafeCSS: `
					* {
						user-select: text;
						-webkit-user-select: text;
					}
					/* No line numbers. The reference has none, and in a chat they're
					   noise: nobody is navigating to line 412 from here. */
					.diffs-line-number,
					[class*="line-number"],
					[class*="lineNumber"] {
						display: none !important;
					}
				`,
			}}
		/>
	);
}
