/**
 * Interim panel for a rail slot whose real view isn't built yet.
 *
 * It keeps the OLD behaviour reachable rather than removing it: converting the
 * rail before its panels exist would have traded four working buttons for two,
 * and a rebuild that takes features away while it lands is a bad trade even if
 * the end state is better.
 */
export function SidebarPendingPanel({
	title,
	description,
	actionLabel,
	onAction,
}: {
	title: string;
	description: string;
	actionLabel: string;
	onAction: () => void;
}) {
	return (
		<div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
			<p className="text-sm text-muted-foreground">{title}</p>
			<p className="text-xs text-muted-foreground/60">{description}</p>
			<button
				type="button"
				onClick={onAction}
				className="mt-1 rounded-md border border-border px-2 py-1 text-xs text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
			>
				{actionLabel}
			</button>
		</div>
	);
}
