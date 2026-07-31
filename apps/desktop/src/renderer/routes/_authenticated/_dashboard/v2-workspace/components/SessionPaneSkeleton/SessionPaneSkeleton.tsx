/**
 * A session pane's shape, before its content exists.
 *
 * Used in two places that both used to show something misleading:
 *  - the workspace layout, which rendered a blank pane (or "Workspace not
 *    found") while the host service was still starting.
 *  - a restored Claude session, which rendered the "Start a Claude Code
 *    session" empty state — starter prompts and all — for a conversation that
 *    already had a hundred messages on disk. Reading "start a session" about a
 *    session you are resuming is worse than reading nothing.
 *
 * Deliberately a transcript rather than a spinner: what is arriving is a
 * conversation, and laying the rows out where they will land means the real
 * content replaces them in place instead of shoving the view around.
 */

import { Skeleton } from "@superset/ui/skeleton";
import { cn } from "@superset/ui/utils";

/**
 * Fixed widths, not random ones.
 *
 * Two reasons. A skeleton whose bars change width between renders reads as
 * broken, and `Math.random()` in a render body would do exactly that on every
 * re-render. Ragged-but-stable widths also read as prose; equal-length bars
 * read as a table.
 */
const TURNS = [
	{ prompt: "w-52", lines: ["w-[92%]", "w-[78%]", "w-[85%]"] },
	{ prompt: "w-36", lines: ["w-[88%]", "w-[64%]"] },
	{ prompt: "w-44", lines: ["w-[95%]", "w-[71%]", "w-[80%]", "w-[45%]"] },
] as const;

/** The conversation column only. Excludes the header and composer. */
export function SessionTranscriptSkeleton() {
	return (
		<div className="flex w-full flex-col px-4 py-4">
			{TURNS.map((turn, index) => (
				<div
					// Static list — the index IS the identity here, there is no data.
					key={turn.prompt}
					className={cn("flex flex-col", index > 0 && "mt-6")}
				>
					{/*
					 * The prompt keeps Skeleton's own `bg-accent`; body lines drop to
					 * 55% of it. Deliberately relative to the primitive rather than a
					 * hand-picked colour — in the default theme `--muted`, `--accent`
					 * and `--border` are all the same value, so inventing opacities
					 * here produced bars fainter than every other skeleton in the app.
					 */}
					<Skeleton className={cn("h-5 rounded-md", turn.prompt)} />
					<div className="mt-3 flex flex-col gap-2">
						{turn.lines.map((line) => (
							<Skeleton
								key={line}
								className={cn("h-3.5 rounded bg-accent/55", line)}
							/>
						))}
					</div>
				</div>
			))}
		</div>
	);
}

/**
 * The whole pane: header, transcript, and the composer's footprint.
 *
 * The composer is drawn as an empty card in the same floating column the real
 * one occupies (`max-w-3xl`, centred, `pb-4`) so it does not appear to jump
 * when the live composer takes over.
 */
export function SessionPaneSkeleton({ className }: { className?: string }) {
	return (
		<div className={cn("relative flex min-h-0 flex-1 flex-col", className)}>
			<div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-4">
				<Skeleton className="size-1.5 rounded-full" />
				<Skeleton className="h-3.5 w-28 rounded" />
				<div className="flex-1" />
				<Skeleton className="h-3.5 w-16 rounded bg-accent/55" />
			</div>
			<div className="min-h-0 flex-1 overflow-hidden">
				<SessionTranscriptSkeleton />
			</div>
			<div className="flex shrink-0 justify-center px-4 pb-4">
				<Skeleton className="h-24 w-full max-w-3xl rounded-2xl bg-accent/55" />
			</div>
		</div>
	);
}
