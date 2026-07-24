import { Tooltip, TooltipContent, TooltipTrigger } from "@superset/ui/tooltip";
import { cn } from "@superset/ui/utils";
import type { SidebarTabDefinition } from "../../types";

interface SidebarHeaderProps {
	tabs: SidebarTabDefinition[];
	activeTab: string;
	onTabChange: (id: string) => void;
	compact?: boolean;
}

/**
 * The sidebar's single top row: a segmented control of tabs (Files / Changes /
 * Browser) plus the active tab's own actions on the right. This is the only
 * header row — the old PR-status row above it was removed, so the tabs sit in
 * the reclaimed space.
 */
export function SidebarHeader({
	tabs,
	activeTab,
	onTabChange,
	compact,
}: SidebarHeaderProps) {
	const actions = tabs.find((t) => t.id === activeTab)?.actions;

	return (
		<div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-2">
			<div className="flex min-w-0 flex-1 items-center gap-0.5 rounded-lg border border-border bg-tertiary p-[3px]">
				{tabs.map((tab) => {
					const isActive = activeTab === tab.id;
					const badge =
						typeof tab.badge === "number" && tab.badge > 0
							? formatBadgeCount(tab.badge)
							: null;
					const label = badge ? `${tab.label} (${badge})` : tab.label;
					const btn = (
						<button
							key={tab.id}
							type="button"
							onClick={() => onTabChange(tab.id)}
							aria-label={label}
							className={cn(
								"flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1 font-medium text-[11.5px] transition-colors",
								isActive
									? "bg-card text-foreground shadow-sm"
									: "text-muted-foreground/80 hover:text-foreground",
							)}
						>
							{tab.icon && <tab.icon className="size-3 shrink-0" />}
							{!compact && <span className="truncate">{tab.label}</span>}
							{badge && (
								<span
									aria-hidden="true"
									className={cn(
										"shrink-0 rounded-full px-1.5 text-[10px] leading-4 tabular-nums",
										isActive
											? "bg-muted text-foreground"
											: "bg-muted/60 text-muted-foreground",
									)}
								>
									{badge}
								</span>
							)}
						</button>
					);

					if (compact) {
						return (
							<Tooltip key={tab.id}>
								<TooltipTrigger asChild>{btn}</TooltipTrigger>
								<TooltipContent side="bottom" showArrow={false}>
									{label}
								</TooltipContent>
							</Tooltip>
						);
					}

					return btn;
				})}
			</div>
			{actions && (
				<div className="flex shrink-0 items-center gap-0.5">{actions}</div>
			)}
		</div>
	);
}

function formatBadgeCount(count: number): string {
	return count > 99 ? "99+" : String(count);
}
