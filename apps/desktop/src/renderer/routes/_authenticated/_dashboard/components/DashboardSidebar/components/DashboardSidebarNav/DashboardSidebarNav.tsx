import { Tooltip, TooltipContent, TooltipTrigger } from "@superset/ui/tooltip";
import { cn } from "@superset/ui/utils";
import { useState } from "react";
import type { IconType } from "react-icons";
import { LuGauge, LuHistory, LuLayers } from "react-icons/lu";
import { UsageDialog } from "renderer/routes/_authenticated/_dashboard/components/UsageDialog/UsageDialog";
import {
	type SidebarPanel,
	useSidebarPanelStore,
} from "renderer/stores/sidebar-panel";

function NavGlyph({
	label,
	Icon,
	selected,
	onClick,
}: {
	label: string;
	Icon: IconType;
	selected: boolean;
	onClick: () => void;
}) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<button
					type="button"
					aria-label={label}
					aria-pressed={selected}
					onClick={onClick}
					className={cn(
						"flex h-8 min-w-0 items-center justify-center gap-1.5 rounded-[7px] px-2 transition-colors",
						label === "Usage" ? "shrink-0" : "flex-1",
						"focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
						selected
							? "bg-background/60 text-foreground shadow-sm"
							: "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
					)}
				>
					<Icon className="size-[14px] shrink-0" />
					{label !== "Usage" && (
						<span className="truncate text-[11px] font-medium">
							{label.startsWith("Workspaces")
								? "Workspaces"
								: "Recent sessions"}
						</span>
					)}
				</button>
			</TooltipTrigger>
			<TooltipContent side="bottom">{label}</TooltipContent>
		</Tooltip>
	);
}

export function DashboardSidebarNav({
	workspaceCount,
}: {
	/** Named in the tooltip, since a glyph has nowhere to print a number. */
	workspaceCount: number;
}) {
	const activePanel = useSidebarPanelStore((state) => state.activePanel);
	const panelOpen = useSidebarPanelStore((state) => state.panelOpen);
	const selectPanel = useSidebarPanelStore((state) => state.selectPanel);
	const [usageOpen, setUsageOpen] = useState(false);

	const isPanel = (panel: SidebarPanel) => panelOpen && activePanel === panel;

	return (
		<div className="mx-2 mt-2 mb-1 flex items-center gap-0.5 rounded-[9px] bg-muted/35 p-1">
			<UsageDialog open={usageOpen} onOpenChange={setUsageOpen} />
			<NavGlyph
				label={workspaceCount ? `Workspaces · ${workspaceCount}` : "Workspaces"}
				Icon={LuLayers}
				selected={isPanel("workspaces")}
				onClick={() => selectPanel("workspaces")}
			/>
			<NavGlyph
				label="Recent sessions"
				Icon={LuHistory}
				selected={isPanel("sessions")}
				onClick={() => selectPanel("sessions")}
			/>
			{/*
			 * Usage stays a DIALOG rather than becoming a panel, for the reason the
			 * rail gives: it is a wide table of accounts plus a heatmap, and it does
			 * not fit a 260px column. Changing what opens it does not change what it
			 * is.
			 */}
			<NavGlyph
				label="Usage"
				Icon={LuGauge}
				selected={usageOpen}
				onClick={() => setUsageOpen(true)}
			/>
		</div>
	);
}
