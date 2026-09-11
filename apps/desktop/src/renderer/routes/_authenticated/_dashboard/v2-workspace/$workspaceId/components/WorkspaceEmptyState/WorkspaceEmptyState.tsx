import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@superset/ui/dropdown-menu";
import { useMemo } from "react";
import type { IconType } from "react-icons";
import { BsTerminalPlus } from "react-icons/bs";
import { LuLayoutPanelTop, LuSearch } from "react-icons/lu";
import { TbWorld } from "react-icons/tb";
import supersetEmptyStateWordmark from "renderer/components/WorkspaceView/ContentView/TabsContent/assets/superset-empty-state-wordmark.svg";
import { EmptyTabActionButton } from "renderer/components/WorkspaceView/ContentView/TabsContent/components/EmptyTabActionButton";
import { useHotkeyDisplay } from "renderer/hotkeys";
import type { V2TerminalPresetRow } from "renderer/routes/_authenticated/providers/CollectionsProvider/dashboardSidebarLocal";
import { useTheme } from "renderer/stores/theme";

interface WorkspaceEmptyStateProps {
	onOpenBrowser: () => void;
	onOpenQuickOpen: () => void;
	onOpenTerminal: () => void;
	/** Agents shown on the presets bar, in the same order. */
	agents?: V2TerminalPresetRow[];
	onLaunchAgent?: (preset: V2TerminalPresetRow) => void;
	/**
	 * Open an agent in a named shape. Offered for presets `canOpenAsPane`
	 * covers, so the same tile in the new-tab launcher and here asks the same
	 * question instead of one of them guessing.
	 */
	onLaunchAgentAs?: (
		preset: V2TerminalPresetRow,
		mode: "pane" | "terminal",
	) => void;
	canOpenAsPane?: (preset: V2TerminalPresetRow) => boolean;
	/** Opens every agent above at once, each in its own pane of one tab. */
	onLaunchAll?: () => void;
}

interface WorkspaceEmptyStateAction {
	display: string[];
	icon: IconType;
	id: string;
	label: string;
	onClick: () => void;
}

export function WorkspaceEmptyState({
	onOpenBrowser,
	onOpenQuickOpen,
	onOpenTerminal,
	agents,
	onLaunchAgent,
	onLaunchAgentAs,
	canOpenAsPane,
	onLaunchAll,
}: WorkspaceEmptyStateProps) {
	const activeTheme = useTheme();
	const { keys: newGroupDisplay } = useHotkeyDisplay("NEW_GROUP");
	const { keys: newBrowserDisplay } = useHotkeyDisplay("NEW_BROWSER");
	const { keys: quickOpenDisplay } = useHotkeyDisplay("QUICK_OPEN");

	const actions = useMemo<Array<WorkspaceEmptyStateAction>>(
		() => [
			{
				id: "terminal",
				label: "Open Terminal",
				display: newGroupDisplay,
				icon: BsTerminalPlus,
				onClick: onOpenTerminal,
			},
			{
				id: "browser",
				label: "Open Browser",
				display: newBrowserDisplay,
				icon: TbWorld,
				onClick: onOpenBrowser,
			},
			{
				id: "search-files",
				label: "Search Files",
				display: quickOpenDisplay,
				icon: LuSearch,
				onClick: onOpenQuickOpen,
			},
		],
		[
			newBrowserDisplay,
			newGroupDisplay,
			onOpenBrowser,
			onOpenQuickOpen,
			onOpenTerminal,
			quickOpenDisplay,
		],
	);

	return (
		<div className="flex h-full flex-1 items-center justify-center px-6 py-10">
			<div className="w-full max-w-xl">
				<div className="mb-7 flex items-center justify-center py-3">
					<img
						alt="Superset"
						className={`h-8 w-auto select-none ${
							activeTheme?.type === "dark"
								? "opacity-85"
								: "brightness-0 opacity-75"
						}`}
						draggable={false}
						src={supersetEmptyStateWordmark}
					/>
				</div>
				{/*
				 * Agents first. An empty workspace is nearly always opened to START
				 * one, and the three generic actions below were the only thing on
				 * offer — so the common case took a trip through a menu.
				 */}
				{agents?.length && onLaunchAgent ? (
					<div className="mx-auto mb-5 w-full max-w-md">
						<div className="grid grid-cols-2 gap-2">
							{agents.map((preset) => {
								const face = (
									<span className="min-w-0 truncate">
										{preset.name || "default"}
									</span>
								);
								const className =
									"flex h-10 w-full items-center gap-2.5 rounded-lg border border-border bg-card px-3 text-left text-[13px] transition-colors hover:border-highlight/50 hover:bg-muted/50";

								if (!onLaunchAgentAs || !canOpenAsPane?.(preset)) {
									return (
										<button
											className={className}
											key={preset.id}
											onClick={() => onLaunchAgent(preset)}
											type="button"
										>
											{face}
										</button>
									);
								}

								return (
									<DropdownMenu key={preset.id}>
										<DropdownMenuTrigger asChild>
											<button className={className} type="button">
												{face}
											</button>
										</DropdownMenuTrigger>
										<DropdownMenuContent align="start" className="w-56">
											<DropdownMenuItem
												onSelect={() => onLaunchAgentAs(preset, "pane")}
											>
												<LuLayoutPanelTop className="size-4 shrink-0 opacity-70" />
												<span className="flex-1">Session pane</span>
											</DropdownMenuItem>
											<DropdownMenuItem
												onSelect={() => onLaunchAgentAs(preset, "terminal")}
											>
												<BsTerminalPlus className="size-4 shrink-0 opacity-70" />
												<span className="flex-1">Terminal</span>
											</DropdownMenuItem>
										</DropdownMenuContent>
									</DropdownMenu>
								);
							})}
						</div>
						{/*
						 * Stated as a count rather than an ellipsis. "Launch more than
						 * one…" reads as a picker you then have to fill in; this says
						 * what the click does and does it in one.
						 */}
						{agents.length > 1 && onLaunchAll ? (
							<button
								className="mt-3 w-full text-center text-[13px] text-highlight transition-colors hover:text-highlight/80"
								onClick={onLaunchAll}
								type="button"
							>
								Launch all {agents.length} side by side
							</button>
						) : null}
					</div>
				) : null}
				<div className="mx-auto grid w-full max-w-md gap-0.5">
					{actions.map((action) => (
						<EmptyTabActionButton
							key={action.id}
							display={action.display}
							icon={action.icon}
							label={action.label}
							onClick={action.onClick}
						/>
					))}
				</div>
			</div>
		</div>
	);
}
