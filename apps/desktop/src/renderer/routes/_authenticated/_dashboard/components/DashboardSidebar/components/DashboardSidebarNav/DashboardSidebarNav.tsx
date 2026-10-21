import { Tooltip, TooltipContent, TooltipTrigger } from "@superset/ui/tooltip";
import { useState } from "react";
import "./sidebar-nav.css";
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
		<Tooltip delayDuration={250} disableHoverableContent>
			<TooltipTrigger asChild>
				<button
					type="button"
					aria-label={label}
					aria-pressed={selected}
					onClick={onClick}
					className="dashboard-sidebar-nav-button"
				>
					<Icon className="size-[22px] shrink-0" />
				</button>
			</TooltipTrigger>
			<TooltipContent
				side="bottom"
				sideOffset={8}
				collisionPadding={12}
				showArrow={false}
				className="dashboard-sidebar-nav-tooltip"
			>
				{label}
			</TooltipContent>
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
		<fieldset className="dashboard-sidebar-nav" aria-label="Sidebar navigation">
			<UsageDialog open={usageOpen} onOpenChange={setUsageOpen} />
			<NavGlyph
				label={workspaceCount ? `Workspaces · ${workspaceCount}` : "Workspaces"}
				Icon={LuLayers}
				selected={!usageOpen && isPanel("workspaces")}
				onClick={() => selectPanel("workspaces")}
			/>
			<NavGlyph
				label="Recent sessions"
				Icon={LuHistory}
				selected={!usageOpen && isPanel("sessions")}
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
		</fieldset>
	);
}
