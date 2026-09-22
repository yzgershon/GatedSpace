/**
 * What the workspace looks like before it has loaded.
 *
 * Stands in for the two things that used to render here: a bare empty div
 * (which read as "the app finished launching and your workspace is gone") and,
 * worse, WorkspaceNotFoundState, which said so in words. Neither was true —
 * the workspace exists, the local host service just hasn't answered yet.
 *
 * Shaped like the real thing rather than centred on a spinner: the tab strip,
 * the conversation column, and the composer land in the positions they will
 * occupy, so the switch to real content is a fill-in rather than a re-layout.
 * Nothing here is interactive and nothing animates position — a skeleton that
 * moves draws the eye to itself instead of to the content arriving.
 */
import { useSkinTokens } from "renderer/hooks/useSkinTokens";
import { SessionPaneSkeleton } from "../SessionPaneSkeleton";

export function WorkspaceLoadingState() {
	const { paneGap, paneRadius, paneSurface } = useSkinTokens();
	return (
		// `output` rather than a div with role="status": it carries that role
		// natively, so a screen reader announces the wait instead of reading
		// nothing at all for the second or two the pane is empty.
		<output
			className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden"
			style={{ padding: paneGap / 2 }}
			aria-busy="true"
			aria-label="Loading workspace"
		>
			<div
				className="flex min-h-0 flex-1 flex-col overflow-hidden"
				style={{
					borderRadius: paneRadius,
					background:
						paneSurface === "raised"
							? "color-mix(in oklab, var(--background) 42%, var(--card))"
							: "var(--background)",
				}}
			>
				<SessionPaneSkeleton />
			</div>
		</output>
	);
}
