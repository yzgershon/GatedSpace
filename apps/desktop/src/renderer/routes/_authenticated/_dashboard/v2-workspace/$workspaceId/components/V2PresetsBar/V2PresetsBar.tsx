import { Button } from "@superset/ui/button";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@superset/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@superset/ui/tooltip";
import { cn } from "@superset/ui/utils";
import { useNavigate } from "@tanstack/react-router";
import { Eye, EyeOff, Settings } from "lucide-react";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useState,
} from "react";
import { HiMiniCommandLine } from "react-icons/hi2";
import { useIsDarkTheme } from "renderer/assets/app-icons/preset-icons";
import { HotkeyMenuShortcut } from "renderer/components/HotkeyMenuShortcut";
import { useV2AgentConfigs } from "renderer/hooks/useV2AgentConfigs";
import type { HotkeyId } from "renderer/hotkeys";
import { resolveV2PresetIcon } from "renderer/lib/preset-icon";
import { useCollections } from "renderer/routes/_authenticated/providers/CollectionsProvider";
import type { V2TerminalPresetRow } from "renderer/routes/_authenticated/providers/CollectionsProvider/dashboardSidebarLocal";
import { useLocalHostService } from "renderer/routes/_authenticated/providers/LocalHostServiceProvider";
import { V2PresetBarItem } from "./components/V2PresetBarItem";

interface V2PresetsBarProps {
	matchedPresets: V2TerminalPresetRow[];
	executePreset: (preset: V2TerminalPresetRow) => void | Promise<void>;
	showPresetsBar: boolean;
	onToggleShowPresetsBar: (enabled: boolean) => void;
	trailing?: ReactNode;
	/**
	 * "row" is the full-width strip under the tab bar. "header" is the compact,
	 * self-contained control that portals into the top bar — it sizes to its
	 * contents, carries its own rounded surface, and drops the border and the
	 * background it would otherwise inherit from being a whole row.
	 */
	variant?: "row" | "header";
}

// Co-located to keep v2 self-contained. Mirrors the v1 array in
// renderer/hotkeys/registry.ts; order matches the registry OPEN_PRESET_{n}
// definitions so PRESET_HOTKEY_IDS[i] targets the i-th visible preset.
const PRESET_HOTKEY_IDS: HotkeyId[] = [
	"OPEN_PRESET_1",
	"OPEN_PRESET_2",
	"OPEN_PRESET_3",
	"OPEN_PRESET_4",
	"OPEN_PRESET_5",
	"OPEN_PRESET_6",
	"OPEN_PRESET_7",
	"OPEN_PRESET_8",
	"OPEN_PRESET_9",
];

function isPresetVisibleInBar(pinnedToBar: boolean | undefined): boolean {
	// The persisted field is legacy "pinned" wording; the v2 UI treats it as
	// show/hide visibility. Undefined defaults to visible for compatibility.
	return pinnedToBar !== false;
}

function areStringArraysEqual(left: string[], right: string[]): boolean {
	if (left.length !== right.length) return false;
	return left.every((value, index) => value === right[index]);
}

function getVisiblePresetOrder(
	presets: ReadonlyArray<{ id: string; pinnedToBar?: boolean }>,
): string[] {
	return presets.flatMap((preset) =>
		isPresetVisibleInBar(preset.pinnedToBar) ? [preset.id] : [],
	);
}

export function V2PresetsBar({
	matchedPresets,
	executePreset,
	showPresetsBar,
	onToggleShowPresetsBar,
	trailing,
	variant = "row",
}: V2PresetsBarProps) {
	const navigate = useNavigate();
	const isDark = useIsDarkTheme();
	const collections = useCollections();
	const { activeHostUrl } = useLocalHostService();
	const { data: agents } = useV2AgentConfigs(activeHostUrl);

	const [localVisiblePresetIds, setLocalVisiblePresetIds] = useState<string[]>(
		() => getVisiblePresetOrder(matchedPresets),
	);

	useEffect(() => {
		const serverVisiblePresetIds = getVisiblePresetOrder(matchedPresets);
		setLocalVisiblePresetIds((current) =>
			areStringArraysEqual(current, serverVisiblePresetIds)
				? current
				: serverVisiblePresetIds,
		);
	}, [matchedPresets]);

	const visiblePresets = useMemo(() => {
		const presetById = new Map(
			matchedPresets.map((preset, index) => [preset.id, { preset, index }]),
		);
		const orderedVisiblePresets: Array<{
			preset: V2TerminalPresetRow;
			index: number;
		}> = [];
		const seenIds = new Set<string>();

		for (const presetId of localVisiblePresetIds) {
			const item = presetById.get(presetId);
			if (!item) continue;
			if (!isPresetVisibleInBar(item.preset.pinnedToBar)) continue;
			orderedVisiblePresets.push(item);
			seenIds.add(presetId);
		}

		for (const [index, preset] of matchedPresets.entries()) {
			if (!isPresetVisibleInBar(preset.pinnedToBar)) continue;
			if (seenIds.has(preset.id)) continue;
			orderedVisiblePresets.push({ preset, index });
		}

		return orderedVisiblePresets;
	}, [matchedPresets, localVisiblePresetIds]);

	const visiblePresetIndexById = useMemo(
		() =>
			new Map(
				visiblePresets.map(({ preset }, visibleIndex) => [
					preset.id,
					visibleIndex,
				]),
			),
		[visiblePresets],
	);

	const handleEditPreset = useCallback(
		(presetId: string) => {
			navigate({
				to: "/settings/terminal",
				search: { editPresetId: presetId },
			});
		},
		[navigate],
	);

	const handleLocalVisibleReorder = useCallback(
		(fromIndex: number, toIndex: number) => {
			setLocalVisiblePresetIds((current) => {
				if (
					fromIndex < 0 ||
					fromIndex >= current.length ||
					toIndex < 0 ||
					toIndex >= current.length
				) {
					return current;
				}
				const next = [...current];
				const [moved] = next.splice(fromIndex, 1);
				next.splice(toIndex, 0, moved);
				return next;
			});
		},
		[],
	);

	const handlePersistVisibleReorder = useCallback(
		(presetId: string, targetVisibleIndex: number) => {
			const reorderedVisiblePresetIds = [...localVisiblePresetIds];
			const currentVisibleIndex = reorderedVisiblePresetIds.indexOf(presetId);
			if (currentVisibleIndex === -1) return;
			const [moved] = reorderedVisiblePresetIds.splice(currentVisibleIndex, 1);
			reorderedVisiblePresetIds.splice(targetVisibleIndex, 0, moved);

			const visibleSet = new Set(reorderedVisiblePresetIds);
			const hidden = matchedPresets
				.filter((preset) => !visibleSet.has(preset.id))
				.map((preset) => preset.id);
			const finalOrder = [...reorderedVisiblePresetIds, ...hidden];
			const currentTabOrderById = new Map(
				matchedPresets.map((preset) => [preset.id, preset.tabOrder]),
			);

			for (const [index, id] of finalOrder.entries()) {
				if (currentTabOrderById.get(id) === index) continue;
				collections.v2TerminalPresets.update(id, (draft) => {
					draft.tabOrder = index;
				});
			}
		},
		[collections.v2TerminalPresets, localVisiblePresetIds, matchedPresets],
	);

	const handleTogglePresetVisibility = useCallback(
		(presetId: string, nextVisible: boolean) => {
			collections.v2TerminalPresets.update(presetId, (draft) => {
				draft.pinnedToBar = nextVisible;
			});
		},
		[collections.v2TerminalPresets],
	);

	return (
		/*
		 * Three sections, not one row: the gear takes the left, the presets take
		 * the middle, and `trailing` takes the right. Both outer sections are
		 * `flex-1` so the middle one is centred on the BAR rather than on
		 * whatever is left over — centring with `mx-auto` drifts the moment
		 * anything is added to either end, which is what made the earlier
		 * attempt look almost-but-not-quite middled.
		 */
		<div
			className={cn(
				"flex min-w-0 shrink-0 items-center overflow-x-auto overflow-y-hidden",
				variant === "header"
					? /*
						 * Sizes to its contents so the top bar can centre it, and carries
						 * its own surface rather than reading as a section of the bar.
						 *
						 * RECESSED, not translucent. `bg-background/60` let the top bar's
						 * own fill through, so the "control" was a faint outline around
						 * four icons with no surface of its own — it read as a group of
						 * buttons that happened to have a border. A well darker than the
						 * bar is what makes the items inside it read as sitting IN
						 * something, which is the whole shape being copied.
						 */
						/*
						 * `h-[46px]`, centred in the 66px band above the cards — ten
						 * pixels clear at each end.
						 *
						 * This was `h-12` — the EXACT height of the bar — so the surface's
						 * own border landed on the window's top edge and it read as
						 * hugging the top of the window rather than floating in the bar.
						 * Measured in the running 1.18.1 window: the surface ran y=1..80
						 * in an 82px bar. Every other surface up here is 46px now, so they
						 * share one baseline instead of four (48 / 42 / 40 / 36).
						 */
						"h-[46px] gap-[3px] rounded-[13px] border border-[color-mix(in_oklab,var(--border)_100%,white_14%)] bg-[color-mix(in_oklab,var(--background)_72%,black)] p-[3px]"
					: "h-9 border-border/60 border-b bg-background px-2",
			)}
			style={{ scrollbarWidth: "none" }}
		>
			<div
				className={cn(
					"flex min-w-0 items-center gap-0.5",
					// In the header the gear does not get a whole third of the width to
					// itself — the control is only as wide as what is in it.
					variant === "header" ? "shrink-0" : "flex-1",
					/*
					 * In the header the gear moves to the far END of the control.
					 *
					 * Leading it, the first thing in a centred group of agents was a
					 * settings cog — so the group stopped reading as one segmented
					 * control of four peers and started reading as a toolbar with a
					 * menu button, which is exactly the difference between this and
					 * the reference. `order-last` moves it visually without moving it
					 * in the DOM, so the tab order still reaches the menu before the
					 * launchers it configures.
					 */
					variant === "header" &&
						"order-last border-border/60 border-l pl-1 ml-0.5",
				)}
			>
				<DropdownMenu>
					<Tooltip>
						<TooltipTrigger asChild>
							<DropdownMenuTrigger asChild>
								<Button
									variant="ghost"
									size="icon"
									className="size-6 shrink-0 text-muted-foreground hover:text-foreground"
								>
									<Settings className="size-3.5" />
								</Button>
							</DropdownMenuTrigger>
						</TooltipTrigger>
						<TooltipContent side="bottom" sideOffset={4}>
							Manage Presets
						</TooltipContent>
					</Tooltip>
					<DropdownMenuContent align="end" className="w-56">
						{matchedPresets.map((preset) => {
							const icon = resolveV2PresetIcon(preset, agents, isDark);
							const isVisible = isPresetVisibleInBar(preset.pinnedToBar);
							const visibleIndex = visiblePresetIndexById.get(preset.id);
							const hotkeyId =
								typeof visibleIndex === "number"
									? PRESET_HOTKEY_IDS[visibleIndex]
									: undefined;
							return (
								<DropdownMenuItem
									key={preset.id}
									className="gap-2"
									onSelect={(event) => {
										event.preventDefault();
										handleTogglePresetVisibility(preset.id, !isVisible);
									}}
								>
									{icon ? (
										<img src={icon} alt="" className="size-4 object-contain" />
									) : (
										<HiMiniCommandLine className="size-4" />
									)}
									<span className="min-w-0 flex-1 truncate">
										{preset.name || "default"}
									</span>
									<div className="ml-auto flex items-center gap-2">
										{isVisible && hotkeyId ? (
											<HotkeyMenuShortcut hotkeyId={hotkeyId} />
										) : null}
										{isVisible ? (
											<Eye className="size-3.5 text-foreground" />
										) : (
											<EyeOff className="size-3.5 text-muted-foreground/60" />
										)}
									</div>
								</DropdownMenuItem>
							);
						})}
						<DropdownMenuSeparator />
						<DropdownMenuCheckboxItem
							checked={showPresetsBar}
							onCheckedChange={(checked) =>
								onToggleShowPresetsBar(checked === true)
							}
							onSelect={(event) => event.preventDefault()}
						>
							Show Preset Bar
						</DropdownMenuCheckboxItem>
						<DropdownMenuSeparator />
						<DropdownMenuItem
							className="gap-2"
							onClick={() => navigate({ to: "/settings/terminal" })}
						>
							<Settings className="size-4" />
							<span>Manage Presets</span>
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</div>
			<div className="flex min-w-0 shrink-0 items-center justify-center gap-1">
				{visiblePresets.map(({ preset }, visibleIndex) => {
					const hotkeyId = PRESET_HOTKEY_IDS[visibleIndex];
					return (
						<V2PresetBarItem
							key={preset.id}
							preset={preset}
							visibleIndex={visibleIndex}
							hotkeyId={hotkeyId}
							isDark={isDark}
							agents={agents}
							onExecutePreset={executePreset}
							onEdit={(presetToEdit) => handleEditPreset(presetToEdit.id)}
							onLocalReorder={handleLocalVisibleReorder}
							onPersistReorder={handlePersistVisibleReorder}
						/>
					);
				})}
			</div>
			<div
				className={cn(
					"flex min-w-0 items-center justify-end gap-0.5",
					variant === "header" ? "shrink-0" : "flex-1",
				)}
			>
				{trailing ? <div className="shrink-0 pl-1">{trailing}</div> : null}
			</div>
		</div>
	);
}
