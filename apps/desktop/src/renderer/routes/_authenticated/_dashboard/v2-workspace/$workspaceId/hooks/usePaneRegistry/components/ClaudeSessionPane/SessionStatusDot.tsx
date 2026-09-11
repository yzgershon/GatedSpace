/**
 * The live status dot at the head of a session pane's title row.
 *
 * The same four states the tab dots already carry — amber working, green
 * finished and unread, red failed, nothing when idle — reading from the same
 * `session-activity` store, so a pane and its tab can never disagree.
 *
 * Why the pane needs one when the tab already has it: a tab dot answers "does
 * something in another tab want me", and stops being useful the moment you are
 * looking at four panes side by side, which is the layout this skin exists for.
 * The dot on the pane answers "which of these four", and that is the question
 * a grid creates.
 *
 * No ping ring, unlike a permission prompt: the pane is on screen, so the state
 * is being reported, not demanded.
 */
import { cn } from "@superset/ui/utils";
import { useSessionPaneStatus } from "renderer/hooks/useSessionPaneStatuses";
import { useSkinTokens } from "renderer/hooks/useSkinTokens";

const LABELS: Record<string, string> = {
	working: "Working",
	review: "Finished, not yet read",
	error: "Failed",
};

export function SessionStatusDot({ paneId }: { paneId: string }) {
	const { paneHeaderStatus } = useSkinTokens();
	const status = useSessionPaneStatus(paneId);
	// `idle` renders nothing rather than a grey dot. A dot that is always there
	// stops being a signal, and the gap is what makes the lit ones read.
	if (!paneHeaderStatus || status === "idle") return null;
	const label = LABELS[status];
	if (!label) return null;
	return (
		<span
			className={cn(
				"size-[7px] shrink-0 rounded-full",
				status === "working" && "animate-pulse bg-warning",
				status === "review" && "bg-success",
				status === "error" && "bg-destructive",
			)}
			title={label}
			aria-label={label}
			role="img"
		/>
	);
}
