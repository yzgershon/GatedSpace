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
import { Skeleton } from "@superset/ui/skeleton";
import { SessionPaneSkeleton } from "../SessionPaneSkeleton";

export function WorkspaceLoadingState() {
	return (
		// `output` rather than a div with role="status": it carries that role
		// natively, so a screen reader announces the wait instead of reading
		// nothing at all for the second or two the pane is empty.
		<output
			className="flex h-full w-full flex-col bg-background"
			aria-busy="true"
			aria-label="Loading workspace"
		>
			<div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-border px-2">
				{/* Active tab at full strength, the one behind it dimmer. */}
				<Skeleton className="h-6 w-36 rounded-md" />
				<Skeleton className="h-6 w-24 rounded-md bg-accent/55" />
			</div>
			<SessionPaneSkeleton />
		</output>
	);
}
