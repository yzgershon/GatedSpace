import { cn } from "@superset/ui/utils";
import type { ActivePaneStatus } from "shared/tabs-types";

// Re-export for consumers
export type { ActivePaneStatus } from "shared/tabs-types";

/** Lookup object for status indicator styling - avoids if/else chains */
const STATUS_CONFIG = {
	permission: {
		pingColor: "bg-red-400",
		dotColor: "bg-red-500",
		pulse: true,
		tooltip: "Needs input",
	},
	working: {
		pingColor: "bg-amber-400",
		dotColor: "bg-amber-500",
		pulse: true,
		tooltip: "Agent working",
	},
	review: {
		pingColor: "",
		dotColor: "bg-green-500",
		pulse: false,
		tooltip: "Ready for review",
	},
	// Same red as `permission`, deliberately WITHOUT the ping. Both mean "this
	// one needs you", and inventing a second alarm colour would only make the
	// palette harder to read at a glance. The pulse is what separates them: a
	// permission prompt is live and waiting, an errored turn is already over.
	error: {
		pingColor: "",
		dotColor: "bg-red-500",
		pulse: false,
		tooltip: "Session error",
	},
} as const satisfies Record<
	ActivePaneStatus,
	{ pingColor: string; dotColor: string; pulse: boolean; tooltip: string }
>;

interface StatusIndicatorProps {
	status: ActivePaneStatus;
	className?: string;
}

/**
 * Visual indicator for pane/workspace status.
 * - Red pulsing: needs user input (permission)
 * - Red static: the turn errored
 * - Amber pulsing: agent working
 * - Green static: ready for review
 */
export function StatusIndicator({ status, className }: StatusIndicatorProps) {
	const config = STATUS_CONFIG[status];

	return (
		<span className={cn("relative flex size-2 shrink-0", className)}>
			{config.pulse && (
				<span
					className={cn(
						"absolute inline-flex h-full w-full animate-ping rounded-full opacity-75",
						config.pingColor,
					)}
				/>
			)}
			<span
				className={cn(
					"relative inline-flex size-2 rounded-full",
					config.dotColor,
				)}
			/>
		</span>
	);
}

/** Get tooltip text for a status - for consumers that wrap with Tooltip */
export function getStatusTooltip(status: ActivePaneStatus): string {
	return STATUS_CONFIG[status].tooltip;
}
