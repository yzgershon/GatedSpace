import type { HostAgentConfig } from "@superset/host-service/settings";
import { Button } from "@superset/ui/button";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
} from "@superset/ui/context-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@superset/ui/tooltip";
import { cn } from "@superset/ui/utils";
import { useRef, useState } from "react";
import { HiMiniCommandLine } from "react-icons/hi2";
import type { HotkeyId } from "renderer/hotkeys";
import { HotkeyLabel } from "renderer/hotkeys";
import { resolveV2PresetIcon } from "renderer/lib/preset-icon";
import { resolveV2PresetIconKey } from "renderer/lib/preset-icon-key";
import type { V2TerminalPresetRow } from "renderer/routes/_authenticated/providers/CollectionsProvider/dashboardSidebarLocal";

interface V2PresetBarItemProps {
	preset: V2TerminalPresetRow;
	visibleIndex: number;
	hotkeyId?: HotkeyId;
	isDark: boolean;
	agents: HostAgentConfig[] | undefined;
	onExecutePreset: (preset: V2TerminalPresetRow) => void;
	onEdit: (preset: V2TerminalPresetRow) => void;
	onLocalReorder: (fromIndex: number, toIndex: number) => void;
	onPersistReorder: (presetId: string, targetVisibleIndex: number) => void;
}

export function V2PresetBarItem({
	preset,
	visibleIndex,
	hotkeyId,
	isDark,
	agents,
	onExecutePreset,
	onEdit,
	onLocalReorder,
	onPersistReorder,
}: V2PresetBarItemProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const icon = resolveV2PresetIcon(preset, agents, isDark);
	// Codex's mark carries more internal padding than the others, so at a shared
	// size it reads noticeably smaller. Size it up to match optically rather than
	// numerically — matching the box is not the same as matching the logo.
	// Both bumped a step on 2026-08-18: these are the most-used controls in the
	// window and were the smallest thing in it. The codex/others gap is kept —
	// it is an optical correction, not a rounding error.
	const iconSize =
		resolveV2PresetIconKey(preset, agents) === "codex"
			? "size-[21px]"
			: "size-5";
	const label = preset.description || preset.name || "default";

	/*
	 * Reorder with POINTER events, not react-dnd's HTML5 backend.
	 *
	 * These pills are portaled into the TOP BAR, which is an Electron window-drag
	 * surface (`-webkit-app-region`). HTML5 drag-and-drop is unreliable inside
	 * one even with `no-drag` on the wrapper, which is why dragging an agent
	 * here did nothing while the same code worked when the presets were their
	 * own row below the bar. Pointer events are not subject to app-region at
	 * all.
	 *
	 * Persistence is unchanged: this still calls `onLocalReorder` while moving
	 * and `onPersistReorder` on release, so the tabOrder write is the same one
	 * the drag backend used to do.
	 */
	const [isDragging, setIsDragging] = useState(false);
	const dragStateRef = useRef<{
		startX: number;
		index: number;
		moved: boolean;
	} | null>(null);

	const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
		// Left button only, and do NOT preventDefault — a plain click must still
		// launch the agent.
		if (event.button !== 0) return;
		dragStateRef.current = {
			startX: event.clientX,
			index: visibleIndex,
			moved: false,
		};

		const onMove = (moveEvent: PointerEvent) => {
			const state = dragStateRef.current;
			const node = containerRef.current;
			if (!state || !node) return;

			// A few pixels of slop, so a click with a shaky hand is still a click.
			if (!state.moved && Math.abs(moveEvent.clientX - state.startX) < 5) {
				return;
			}
			if (!state.moved) {
				state.moved = true;
				setIsDragging(true);
			}

			const row = node.parentElement;
			if (!row) return;
			const pills = Array.from(
				row.querySelectorAll<HTMLElement>("[data-preset-index]"),
			);
			const targetIndex = pills.findIndex((pill) => {
				const rect = pill.getBoundingClientRect();
				return (
					moveEvent.clientX >= rect.left && moveEvent.clientX <= rect.right
				);
			});
			if (targetIndex < 0 || targetIndex === state.index) return;

			onLocalReorder(state.index, targetIndex);
			state.index = targetIndex;
		};

		const onUp = () => {
			const state = dragStateRef.current;
			dragStateRef.current = null;
			window.removeEventListener("pointermove", onMove);
			window.removeEventListener("pointerup", onUp);
			if (!state?.moved) return;
			setIsDragging(false);
			if (state.index !== visibleIndex) {
				onPersistReorder(preset.id, state.index);
			}
		};

		window.addEventListener("pointermove", onMove);
		window.addEventListener("pointerup", onUp);
	};

	return (
		<ContextMenu>
			<ContextMenuTrigger asChild>
				<div
					ref={containerRef}
					data-preset-index={visibleIndex}
					data-preset-id={preset.id}
					className={isDragging ? "opacity-40" : undefined}
					style={{ cursor: isDragging ? "grabbing" : "grab" }}
					onPointerDown={handlePointerDown}
					onClickCapture={(event) => {
						// The click that ends a drag must not also launch the agent.
						if (isDragging) {
							event.preventDefault();
							event.stopPropagation();
						}
					}}
				>
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								variant="ghost"
								size="sm"
								/*
								 * 40px inside the surface's 3px padding = the 46px row every
								 * other surface in the bar is on. One label size (15px) and
								 * one glyph size (20px) with the tab rail, which used to run
								 * 13.5px and 17px — close enough to read as a mistake rather
								 * than a hierarchy.
								 *
								 * `duration-100`, not the 150ms default: this is hover
								 * feedback on the most-clicked control in the window, and
								 * anything past about 120ms stops reading as a response to
								 * the pointer and starts reading as the app catching up.
								 */
								className="h-10 max-w-44 min-w-0 shrink-0 gap-2 rounded-[10px] px-3.5 font-normal text-[15px] text-muted-foreground transition-colors duration-100 hover:bg-muted/60 hover:text-foreground"
								onClick={() => onExecutePreset(preset)}
							>
								{icon ? (
									<img
										src={icon}
										alt=""
										className={cn(
											iconSize,
											"shrink-0 object-contain opacity-90",
										)}
									/>
								) : (
									<HiMiniCommandLine className="size-5 shrink-0" />
								)}
								<span className="min-w-0 truncate">
									{preset.name || "default"}
								</span>
							</Button>
						</TooltipTrigger>
						<TooltipContent side="bottom" sideOffset={4}>
							<HotkeyLabel label={label} id={hotkeyId} />
						</TooltipContent>
					</Tooltip>
				</div>
			</ContextMenuTrigger>
			<ContextMenuContent>
				<ContextMenuItem onSelect={() => onExecutePreset(preset)}>
					Run preset
				</ContextMenuItem>
				<ContextMenuSeparator />
				<ContextMenuItem onSelect={() => onEdit(preset)}>
					Edit preset
				</ContextMenuItem>
			</ContextMenuContent>
		</ContextMenu>
	);
}
