import { cn } from "@superset/ui/utils";
import type { ReactNode } from "react";
import type { ActivePaneStatus } from "shared/tabs-types";

const RING_CLASS = {
	working: "ring-warning",
	permission: "ring-destructive",
	review: "ring-success",
	error: "ring-destructive",
} as const;
export function AgentStatusRing({
	status,
	children,
}: {
	status: ActivePaneStatus | null;
	children: ReactNode;
}) {
	return (
		<span
			data-agent-status={status ?? "idle"}
			className={cn(
				"gs-agent-status-ring flex size-5 shrink-0 items-center justify-center rounded-[5px] text-foreground",
				status && "ring-2",
				status && RING_CLASS[status],
				status === "working" && "gs-agent-status-working",
			)}
		>
			{children}
		</span>
	);
}
