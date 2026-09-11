/**
 * The sidebar's nav, as a HORIZONTAL row of lit glyphs.
 *
 * These were three text rows, and before that three glyphs in a 48px vertical
 * rail. The rail cost a whole column of every window and still needed a tooltip
 * to say what anything did; the text rows read cleanly but spent 96px of
 * vertical space above the workspace tree, which is the part you actually
 * navigate. A horizontal row is the third option: one line, still readable
 * because there are only three of them, and the tree starts higher.
 *
 * THE GLOW IS THE RAIL'S, unchanged, because it was right. Two drop-shadows
 * rather than one: a tight core at 5px and a wide falloff at 13px. A single
 * large blur reads as haze around the glyph; a tight core plus a wide falloff
 * is what reads as lit. It goes on the ICON so the light comes off the strokes
 * rather than off a square.
 *
 * NO SELECTION BAR. The rail kept one on the reasoning that a glow says
 * "something here is lit" without saying WHICH of three adjacent icons. With
 * three glyphs this far apart and only one ever lit, the glow answers both, and
 * the bar was a second orange object competing with it.
 *
 * Behaviour is UNCHANGED: the same panel store, the same usage dialog.
 * Selecting a panel is not navigation — it swaps what shows below and leaves
 * the workspace you are working in alone.
 */
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

/** The rail's lit look, kept to the value rather than re-tuned. */
const GLOW =
	"drop-shadow(0 0 5px color-mix(in oklab, var(--highlight) 80%, transparent)) drop-shadow(0 0 13px color-mix(in oklab, var(--highlight) 45%, transparent))";

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
						"flex h-9 flex-1 items-center justify-center rounded-[8px] transition-colors",
						"focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
						selected
							? "text-highlight"
							: "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
					)}
				>
					<Icon
						className="size-[19px]"
						style={selected ? { filter: GLOW } : undefined}
					/>
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
		<div className="flex items-center gap-1 px-2 py-3">
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
