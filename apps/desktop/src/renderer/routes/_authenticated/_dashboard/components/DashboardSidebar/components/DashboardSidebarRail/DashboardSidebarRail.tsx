/**
 * The icon rail — an activity bar, not a menu.
 *
 * Clicking a PANEL icon changes which panel shows beside it and nothing else:
 * it doesn't navigate, and it doesn't disturb the workspace you're working in.
 *
 * Usage is deliberately NOT a panel. It's a dialog, because that's what it
 * already was and what it's shaped like — a wide table of accounts and a
 * heatmap doesn't fit a 260px column, and forcing it into one would have meant
 * rebuilding a view that already works.
 *
 * Settings and help pin to the bottom, so the top group stays a list of places
 * and the bottom group stays a list of tools.
 */
import { Tooltip, TooltipContent, TooltipTrigger } from "@superset/ui/tooltip";
import { cn } from "@superset/ui/utils";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import type { IconType } from "react-icons";
import { HiOutlineCog6Tooth } from "react-icons/hi2";
import { LuGauge, LuHistory, LuLayers } from "react-icons/lu";
import { UsageDialog } from "renderer/routes/_authenticated/_dashboard/components/UsageDialog/UsageDialog";
import {
	type SidebarPanel,
	useSidebarPanelStore,
} from "renderer/stores/sidebar-panel";
import { DashboardSidebarHelpMenu } from "../DashboardSidebarHelpMenu";

/** A rail entry that swaps the panel beside it. */
interface PanelItem {
	kind: "panel";
	panel: SidebarPanel;
	label: string;
	Icon: IconType;
}

/** A rail entry that performs an action and leaves the panel alone. */
interface ActionItem {
	kind: "action";
	id: string;
	label: string;
	Icon: IconType;
}

const ITEMS: (PanelItem | ActionItem)[] = [
	{ kind: "panel", panel: "workspaces", label: "Workspaces", Icon: LuLayers },
	{
		kind: "panel",
		panel: "sessions",
		label: "Recent sessions",
		Icon: LuHistory,
	},
	{ kind: "action", id: "usage", label: "Usage", Icon: LuGauge },
];

function RailButton({
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
						"relative flex size-11 items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
						selected
							? "text-highlight"
							: "text-muted-foreground hover:text-foreground",
					)}
				>
					{/*
					 * The bar carries the state; the glow below carries the mood.
					 *
					 * Keeping both is deliberate. A glow says "something here is lit", it
					 * does not say WHICH of three adjacent icons — not at a glance, and
					 * not with a bright window bleeding through behind the app. Drop the
					 * bar and selection becomes something you have to look for.
					 *
					 * An edge bar rather than a filled tile: it survives every theme
					 * without needing a colour that contrasts with both the rail and the
					 * panel.
					 */}
					{selected ? (
						<span className="absolute inset-y-1.5 left-0 w-0.5 rounded-r bg-highlight" />
					) : null}
					{/*
					 * Two shadows, tight and wide, rather than one. A single large blur
					 * reads as haze around the glyph; a tight core plus a wide falloff is
					 * what reads as lit. Applied to the icon and not the button so the
					 * light comes off the strokes rather than off a 44px square.
					 */}
					<Icon
						className="size-[22px]"
						style={
							selected
								? {
										filter:
											"drop-shadow(0 0 5px color-mix(in oklab, var(--highlight) 80%, transparent)) drop-shadow(0 0 13px color-mix(in oklab, var(--highlight) 45%, transparent))",
									}
								: undefined
						}
					/>
				</button>
			</TooltipTrigger>
			<TooltipContent side="right">{label}</TooltipContent>
		</Tooltip>
	);
}

export function DashboardSidebarRail({
	/**
	 * Draw the divider between rail and panel.
	 *
	 * Off when the panel is hidden: the resizable container draws its own right
	 * border, so an unconditional one here put two 1px lines side by side at the
	 * collapsed edge — subtle, but it reads as a rendering artefact.
	 */
	showDivider = true,
}: {
	showDivider?: boolean;
} = {}) {
	const navigate = useNavigate();
	const activePanel = useSidebarPanelStore((state) => state.activePanel);
	const panelOpen = useSidebarPanelStore((state) => state.panelOpen);
	const selectPanel = useSidebarPanelStore((state) => state.selectPanel);
	const [usageOpen, setUsageOpen] = useState(false);

	return (
		<>
			<UsageDialog open={usageOpen} onOpenChange={setUsageOpen} />
			{/* w-12 = 48px, which COLLAPSED_WORKSPACE_SIDEBAR_WIDTH must match. */}
			<div
				className={cn(
					/*
					 * The rail sits on the APP background, not the sidebar surface.
					 *
					 * It used to be `bg-sidebar`, the same colour as the panel beside it,
					 * separated only by a border at 45% opacity — about a 4% lightness
					 * step, which is invisible in practice. The result was that there was
					 * no toolbar: three dim glyphs floating in the panel's own margin.
					 * Centring them made it read louder, because nothing anchored them to
					 * an edge either.
					 *
					 * Dropping the rail to `bg-background` makes the panel read as the
					 * raised surface and gives the icons something to belong to. The
					 * divider goes to full strength for the same reason — at 45% it was
					 * doing nothing.
					 */
					"relative flex h-full w-12 shrink-0 flex-col items-center bg-background",
					showDivider && "border-r border-border",
				)}
			>
				{/*
				 * Centred on the rail, not stacked under the top edge.
				 *
				 * Absolutely positioned rather than centred with flex, because Settings
				 * and Help are pinned to the bottom of the same column: with everything
				 * in flow, equal spacers put the "centre" about 40px high, since the
				 * lower spacer has to share its space with that bottom group.
				 *
				 * This also retires the old `mt-9`, which existed to clear the window
				 * chrome from the first icon. Nothing is near the top edge now. The
				 * group is ~132px tall, so it only reaches the chrome on a window under
				 * ~200px, which is far below any usable size.
				 */}
				<div className="-translate-y-1/2 absolute top-1/2 flex flex-col items-center gap-0.5">
					{ITEMS.map((item) =>
						item.kind === "panel" ? (
							<RailButton
								key={item.panel}
								label={item.label}
								Icon={item.Icon}
								// Only "selected" while its panel is actually showing —
								// otherwise a collapsed sidebar still claims one is active.
								selected={panelOpen && activePanel === item.panel}
								onClick={() => selectPanel(item.panel)}
							/>
						) : (
							<RailButton
								key={item.id}
								label={item.label}
								Icon={item.Icon}
								selected={usageOpen}
								onClick={() => setUsageOpen(true)}
							/>
						),
					)}
				</div>

				<div className="flex-1" />

				<div className="flex flex-col items-center pb-1.5">
					<Tooltip>
						<TooltipTrigger asChild>
							<button
								type="button"
								aria-label="Settings"
								onClick={() => navigate({ to: "/settings/account" })}
								className="flex size-11 items-center justify-center text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
							>
								<HiOutlineCog6Tooth className="size-[22px]" />
							</button>
						</TooltipTrigger>
						<TooltipContent side="right">Settings</TooltipContent>
					</Tooltip>
					<DashboardSidebarHelpMenu isCollapsed />
				</div>
			</div>
		</>
	);
}
