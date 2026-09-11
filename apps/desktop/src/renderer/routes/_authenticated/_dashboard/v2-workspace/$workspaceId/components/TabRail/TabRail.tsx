/**
 * The tab strip, as a rail of collapsing pills in the top bar.
 *
 * Replaces `GroupSwitcher`, which replaced the 40px strip. The pill said the
 * name of the group you were IN and hid the rest behind a dropdown, so every
 * other group cost a click to even identify. The rail keeps the pill's saved
 * vertical space and gives the other groups back: one expanded tab, the rest
 * collapsed to their agent mark, opening on hover or focus.
 *
 * ANCHORED RIGHT, GROWING LEFT. It sits between the centred preset launcher
 * and the right-hand cluster, and expands into the empty middle. Anchoring it
 * left would push the window controls sideways every time a tab opened.
 *
 * THE DROP TARGET IS LOAD-BEARING, and it is the reason this component cannot
 * just be a list. Dragging a pane out of its tab onto empty strip space was the
 * only one-gesture way to give a pane its own group; the strip's deletion
 * nearly took it, and the pill existed largely to keep it alive. The rail is
 * that target, and it says so mid-drag rather than relying on anyone guessing.
 *
 * EACH TAB IS ALSO A DRAG SOURCE, on POINTER EVENTS ONLY — see
 * `useTabRailDrag.ts`, whose header documents the two-drag-systems collision
 * that produced the crossed-circle cursor, the tab that would not move, the
 * merge nobody asked for, and the tab that could not be clicked again until the
 * app was restarted. Nothing here may become an HTML5 drag source again.
 *
 * Reordering is the DEFAULT and the merge is the deliberate one: pull a tab
 * clear of the rail and a pane lights up saying what will happen. It used to be
 * the other way round — a sideways drag merged silently and reordering did
 * nothing.
 *
 * STATUS IS NOT COLOUR ALONE. The ring around the mark carries it, a working
 * tab pulses, and the accessible name says the word — "Claude, working". A
 * collapsed tab whose only signal is a colour is unreadable to anyone who
 * cannot separate amber from the orange agent mark beside it, and on this
 * palette `--warning` (#d4a84b) and `--highlight` (#e07850) genuinely are
 * close.
 */

import type { PaneRegistry, WorkspaceStore } from "@superset/panes";
import { PANE_DRAG_TYPE, resolveTabTitle } from "@superset/panes";
import { Tooltip, TooltipContent, TooltipTrigger } from "@superset/ui/tooltip";
import { cn } from "@superset/ui/utils";
import { useCallback, useEffect, useRef, useState } from "react";
import { useDrop } from "react-dnd";
import { createPortal } from "react-dom";
import { LuPlus, LuX } from "react-icons/lu";
import { getStatusTooltip } from "renderer/components/StatusIndicator";
import { useV2SourcesNotificationStatus } from "renderer/hooks/host-service/useV2NotificationStatus";
import { useWorkspace } from "renderer/routes/_authenticated/_dashboard/v2-workspace/providers/WorkspaceProvider";
import { getV2NotificationSourcesForTab } from "renderer/stores/v2-notifications";
import { useStore } from "zustand";
import type { StoreApi } from "zustand/vanilla";
import type { PaneViewerData } from "../../types";
import { computeSlideOffset, overlayRect } from "./tabRailDrag";
import {
	NO_DRAG_ATTRIBUTE,
	type PaneDropTarget,
	type TabRailDrag,
	useTabRailDrag,
} from "./useTabRailDrag";

interface PaneDragItem {
	paneId?: string;
}

interface TabRailProps {
	store: StoreApi<WorkspaceStore<PaneViewerData>>;
	registry: PaneRegistry<PaneViewerData>;
	/** Makes an undecided group, the same one the strip's `+` used to make. */
	onNewGroup: () => void;
	newGroupHint?: string;
	/**
	 * Closes a group through the SAME path the strip's × used.
	 *
	 * Not `store.removeTab` directly: that skips `onBeforeCloseTab`, which is
	 * the dirty-tab guard. A group holding a half-written prompt would close
	 * without asking, and the prompt is not recoverable.
	 */
	onCloseGroup: (tabId: string) => void;
}

/**
 * The ring colour for a status.
 *
 * Deliberately the same four the sidebar and the old tab dots use, so one
 * status never has two colours depending on where you read it.
 */
const RING_CLASS = {
	working: "ring-warning",
	permission: "ring-destructive",
	review: "ring-success",
	error: "ring-destructive",
} as const;

function TabRailItem({
	tab,
	tabs,
	index,
	registry,
	isActive,
	drag,
	onSelect,
	onCloseGroup,
	onStartRename,
}: {
	tab: WorkspaceStore<PaneViewerData>["tabs"][number];
	tabs: WorkspaceStore<PaneViewerData>["tabs"];
	/** Its slot in the rail, which is what the gap arithmetic is keyed on. */
	index: number;
	registry: PaneRegistry<PaneViewerData>;
	isActive: boolean;
	drag: TabRailDrag;
	onSelect: (tabId: string) => void;
	onCloseGroup: (tabId: string) => void;
	onStartRename: () => void;
}) {
	const { workspace } = useWorkspace();
	const status = useV2SourcesNotificationStatus(
		workspace.id,
		getV2NotificationSourcesForTab(tab),
	);

	const paneIds = Object.keys(tab.panes);
	const paneCount = paneIds.length;
	/*
	 * The tab's face is its ACTIVE pane, falling back to the first.
	 *
	 * A tab holding a Claude session and a terminal has to pick one to be, and
	 * the one you last looked at is the better guess than whichever landed first
	 * in the object.
	 */
	const facePaneId =
		tab.activePaneId && tab.panes[tab.activePaneId]
			? tab.activePaneId
			: paneIds[0];
	const facePane = facePaneId ? tab.panes[facePaneId] : undefined;
	const icon = facePane
		? registry[facePane.kind]?.getTabIcon?.(facePane)
		: null;
	const title = resolveTabTitle(tab, tabs, registry);

	// The word, not just the colour — this is the accessible name and the
	// tooltip both, so status survives for anyone who cannot read the ring.
	const statusWord = status ? getStatusTooltip(status) : null;
	const label = statusWord ? `${title} — ${statusWord}` : title;

	/*
	 * The chip's own drag state, derived from the rail's single session.
	 *
	 * Held by the PARENT, not here: opening a gap means moving the chips this
	 * one is passing, and a per-item handler can only see itself. That is why
	 * the old version could not animate anything — it mutated store order on
	 * every pointer move instead, so the row jumped between two arrangements
	 * rather than sliding between them.
	 */
	const isDragged = drag.state?.tabId === tab.id;
	const slide = drag.state
		? computeSlideOffset(
				index,
				drag.state.fromIndex,
				drag.state.toIndex,
				drag.state.draggedWidth,
			)
		: 0;
	const overPane = Boolean(drag.state?.paneTarget);

	const transform = isDragged
		? `translate3d(${drag.state?.offset ?? 0}px, 0, 0) rotate(${
				drag.state?.tilt ?? 0
			}deg) scale(${overPane ? 0.94 : 1.04})`
		: slide !== 0
			? `translate3d(${slide}px, 0, 0)`
			: undefined;

	const nodeRef = useRef<HTMLDivElement | null>(null);

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<div
					ref={nodeRef}
					data-active={isActive}
					data-rail-tab={tab.id}
					onPointerDown={(event) => drag.start(event, tab.id)}
					onClickCapture={(event) => {
						// The click that ends a drag is not a click on the tab. Without
						// this, dropping a tab also activates it.
						if (drag.shouldSwallowClick(tab.id)) {
							event.preventDefault();
							event.stopPropagation();
						}
					}}
					style={{
						transform,
						/*
						 * The lifted chip tracks the pointer 1:1 — a transition here
						 * would put it behind the finger, which is precisely the lag
						 * that makes a drag feel cheap. Everything else eases, because
						 * a gap opening instantly reads as a glitch rather than as room
						 * being made.
						 */
						transitionProperty: isDragged
							? "box-shadow, opacity"
							: "transform, background-color, color, box-shadow",
						transitionDuration: isDragged ? "120ms" : "180ms",
						// Overshoots slightly on the way in, so the row settles rather
						// than stopping dead.
						transitionTimingFunction: "cubic-bezier(0.2, 0.9, 0.25, 1.15)",
						zIndex: isDragged ? 2 : undefined,
						cursor: isDragged ? "grabbing" : undefined,
					}}
					className={cn(
						// `duration-100` rather than the 150ms default: hovering a tab
						// should feel like the pointer landed on it, not like the app
						// noticed a moment later.
						"gs-tabrail-tab no-drag relative flex h-10 shrink-0 items-center rounded-[10px] pr-2.5 pl-2 duration-100",
						"focus-within:ring-1 focus-within:ring-ring",
						// Lifted: a shadow under it and a brighter edge, so it reads as
						// picked UP rather than merely displaced.
						isDragged &&
							"shadow-[0_10px_24px_-8px_rgba(0,0,0,0.85)] ring-1 ring-highlight/50",
						// Over a pane the chip is no longer the thing being placed —
						// the overlay is — so it steps back rather than competing.
						isDragged && overPane && "opacity-45",
						isActive
							? "bg-card text-foreground shadow-[inset_0_0_0_1px_rgba(224,120,80,0.34)]"
							: "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
					)}
				>
					<button
						type="button"
						aria-label={label}
						aria-current={isActive ? "true" : undefined}
						/*
						 * 14px and an 18px glyph: the one label size and the one icon
						 * size the whole top bar uses now.
						 *
						 * NO `gap` here. The label is collapsed with `max-width: 0`, not
						 * `display: none`, so it stays a flex item — a gap would pad every
						 * icon-only tab with dead space it never had. The spacing is the
						 * label's own `margin-left`, which animates 0 -> 7px with the
						 * reveal (globals.css).
						 */
						className="flex min-w-0 items-center text-[15px] focus-visible:outline-none"
						onClick={() => onSelect(tab.id)}
						onAuxClick={(event) => {
							// Middle-click closes, the same as the strip's tabs did.
							if (event.button !== 1) return;
							event.preventDefault();
							onCloseGroup(tab.id);
						}}
						onDoubleClick={(event) => {
							if (!isActive) return;
							event.preventDefault();
							event.stopPropagation();
							onStartRename();
						}}
					>
						<span
							className={cn(
								"flex size-5 shrink-0 items-center justify-center rounded-[5px] text-foreground",
								status && "ring-2",
								status && RING_CLASS[status],
								status === "working" && "animate-pulse",
							)}
						>
							{icon}
						</span>
						<span className="gs-tabrail-label flex items-center gap-1.5">
							<span className="truncate">{title}</span>
							{paneCount > 1 ? (
								<span className="shrink-0 text-[11.5px] text-muted-foreground/60 tabular-nums">
									{paneCount}
								</span>
							) : null}
						</span>
					</button>
					{/*
					 * Close ONLY on the active tab, and only there.
					 *
					 * The rail is anchored right, so a collapsed tab expands from a
					 * FIXED RIGHT EDGE and whatever ends up last lands under the
					 * pointer that opened it. Hovering a tab to read its name put the
					 * cursor on the button that closes it.
					 *
					 * Moving the ✕ to the lead fixed that and broke the look: it read
					 * as a stray mark floating in front of the tab, and the 20px it
					 * claimed on every open tab pushed the rail into an overflow it
					 * could not scroll out of.
					 *
					 * The active tab is ALREADY expanded, so hovering it moves nothing
					 * and the button cannot arrive under a stationary cursor. Every
					 * other tab keeps middle-click, which is what the strip always had.
					 */}
					{isActive ? (
						<button
							type="button"
							/*
							 * Not a drag handle. The chip as a whole is, so without this
							 * the ✕ would begin a drag on press and its click would then
							 * be swallowed as drag fallout.
							 */
							{...{ [NO_DRAG_ATTRIBUTE]: "" }}
							aria-label={`Close ${title}`}
							className="ml-1 flex size-[17px] shrink-0 items-center justify-center rounded text-muted-foreground/55 transition-colors duration-100 hover:bg-foreground/10 hover:text-foreground focus-visible:outline-none"
							onClick={(event) => {
								event.stopPropagation();
								onCloseGroup(tab.id);
							}}
						>
							<LuX className="size-3.5" />
						</button>
					) : null}
				</div>
			</TooltipTrigger>
			{/*
			 * No tooltip mid-drag. The trigger is being translated around, and a
			 * popover anchored to a moving element chases it across the screen —
			 * so the name of a tab you are already holding obscures the row you
			 * are trying to drop it into. Unmounting the CONTENT rather than
			 * controlling `open` keeps the tooltip uncontrolled throughout;
			 * flipping between controlled and uncontrolled is its own bug.
			 */}
			{drag.state ? null : (
				<TooltipContent side="bottom" showArrow={false}>
					{label}
				</TooltipContent>
			)}
		</Tooltip>
	);
}

export function TabRail({
	store,
	registry,
	onNewGroup,
	newGroupHint,
	onCloseGroup,
}: TabRailProps) {
	const tabs = useStore(store, (s) => s.tabs);
	const activeTabId = useStore(store, (s) => s.activeTabId);

	/*
	 * The strip's drop behaviour, kept whole.
	 *
	 * `canDrop` is false for a pane that is already alone in its tab: moving it
	 * out would destroy the tab it came from and create an identical one, so the
	 * gesture would look like it did nothing. Refusing it says so.
	 */
	const [{ isOver, canDrop }, connectDrop] = useDrop(
		() => ({
			accept: PANE_DRAG_TYPE,
			canDrop: (item: PaneDragItem) => {
				const paneId = item.paneId;
				if (!paneId) return false;
				const owner = store.getState().tabs.find((tab) => paneId in tab.panes);
				return !!owner && Object.keys(owner.panes).length > 1;
			},
			drop: (item: PaneDragItem) => {
				if (!item.paneId) return;
				store.getState().movePaneToNewTab({ paneId: item.paneId });
			},
			collect: (monitor) => ({
				isOver: monitor.isOver() && monitor.canDrop(),
				canDrop: monitor.canDrop(),
			}),
		}),
		[store],
	);
	/*
	 * `connectDrop` needs the node and so does the drag, which measures its own
	 * chips against the rail's box to keep the lifted one inside it.
	 */
	const railRef = useRef<HTMLDivElement | null>(null);
	const setRef = useCallback(
		(node: HTMLDivElement | null) => {
			railRef.current = node;
			connectDrop(node);
		},
		[connectDrop],
	);

	const drag = useTabRailDrag({ store, railRef });
	const selectTab = useCallback(
		(tabId: string) => store.getState().setActiveTab(tabId),
		[store],
	);

	/*
	 * Two pieces of state, not one nullable draft: the effect that focuses the
	 * field has to fire when editing STARTS and not on every keystroke, so it
	 * needs a dependency that only changes at that moment.
	 */
	const [renamingTabId, setRenamingTabId] = useState<string | null>(null);
	const [draftTitle, setDraftTitle] = useState("");
	const inputRef = useRef<HTMLInputElement>(null);
	useEffect(() => {
		if (!renamingTabId) return;
		// focus() before select(): the field mounts unfocused, and select() on an
		// unfocused input does not reliably focus it.
		inputRef.current?.focus();
		inputRef.current?.select();
	}, [renamingTabId]);

	const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null;

	const startRename = () => {
		if (!activeTab) return;
		setRenamingTabId(activeTab.id);
		setDraftTitle(resolveTabTitle(activeTab, tabs, registry));
	};

	const commitRename = () => {
		const tabId = renamingTabId;
		const next = draftTitle.trim();
		setRenamingTabId(null);
		if (!tabId) return;
		store.getState().setTabTitleOverride({
			tabId,
			// An empty name is a request to go back to the derived one, not a
			// request for a blank tab. The same rule the strip used.
			titleOverride: next.length > 0 ? next : undefined,
		});
	};

	if (renamingTabId) {
		return (
			<input
				ref={inputRef}
				value={draftTitle}
				aria-label="Group name"
				className="no-drag h-8 w-[200px] rounded-lg bg-accent/40 px-2.5 text-[14px] text-foreground outline-none ring-1 ring-highlight/50"
				onBlur={commitRename}
				onChange={(event) => setDraftTitle(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === "Enter") {
						event.preventDefault();
						commitRename();
					} else if (event.key === "Escape") {
						event.preventDefault();
						setRenamingTabId(null);
					}
				}}
			/>
		);
	}

	return (
		<div
			ref={setRef}
			className={cn(
				/*
				 * A border that survives the well.
				 *
				 * `--border` (#2a2827) at 65% over a #0d0a09 ground lands around
				 * #1e1c1b, which is a nine-value step and effectively invisible —
				 * the same "under 10% is not a step" problem the pane surface hit.
				 * Lifting it toward white gives the floating objects an edge you can
				 * find, and the presets bar uses the identical value so the two read
				 * as the same kind of thing.
				 */
				/*
				 * `h-[46px]`, the same row the agents surface sits on. It used to size
				 * itself from its contents (36px tabs + 3px padding = 42px), which
				 * put it two pixels off the launcher across the bar — near enough to
				 * look like a rendering difference rather than a decision.
				 */
				"no-drag flex h-[46px] min-w-0 items-center gap-[3px] rounded-[13px] border border-[color-mix(in_oklab,var(--border)_100%,white_14%)] bg-[rgba(13,10,9,0.72)] p-[3px]",
				"shadow-[0_6px_20px_-10px_rgba(0,0,0,0.9)] transition-colors",
				// Mid-drag the rail stops being a list and starts being a target,
				// and says which of the two it currently is.
				canDrop && "ring-1 ring-highlight/40",
				isOver && "bg-highlight/15 ring-1 ring-highlight",
			)}
		>
			{canDrop && isOver ? (
				<span className="px-2 text-[12px] text-foreground">
					Release for a new group
				</span>
			) : (
				tabs.map((tab, index) => (
					<TabRailItem
						key={tab.id}
						tab={tab}
						tabs={tabs}
						index={index}
						registry={registry}
						isActive={tab.id === activeTabId}
						drag={drag}
						onSelect={selectTab}
						onCloseGroup={onCloseGroup}
						onStartRename={startRename}
					/>
				))
			)}

			<span className="mx-1 h-5 w-px shrink-0 bg-border" />
			<Tooltip>
				<TooltipTrigger asChild>
					<button
						type="button"
						aria-label="New group"
						className="no-drag flex size-10 shrink-0 items-center justify-center rounded-[10px] text-muted-foreground/60 transition-colors duration-100 hover:bg-accent/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
						onClick={onNewGroup}
					>
						<LuPlus className="size-5" />
					</button>
				</TooltipTrigger>
				<TooltipContent side="bottom" showArrow={false}>
					{newGroupHint ? `New group · ${newGroupHint}` : "New group"}
				</TooltipContent>
			</Tooltip>
			<PaneDropPreview target={drag.state?.paneTarget ?? null} />
		</div>
	);
}

/**
 * What a tab pulled out of the rail is about to do, drawn on the pane itself.
 *
 * This gesture used to be INVISIBLE: releasing a tab anywhere over a pane
 * merged the two groups with nothing having said so, which is why it read as
 * the tab teleporting to the cursor. Naming the half it will take turns the
 * same capability into something you can aim, and — more to the point — see
 * coming and abort.
 *
 * Portalled to the body because the rail sits in a horizontally scrolling bar;
 * an absolutely positioned overlay would be clipped to the top bar and paint
 * nothing at all.
 */
function PaneDropPreview({ target }: { target: PaneDropTarget | null }) {
	if (!target) return null;
	const box = overlayRect(target.rect, target.position);
	return createPortal(
		<div
			// Never a drop target itself: hit-testing walks up from
			// `elementFromPoint`, and an overlay under the cursor would mask the
			// pane it is describing and cancel the drop it exists to promise.
			className="pointer-events-none fixed z-[60] flex items-center justify-center rounded-[10px] bg-highlight/20 ring-2 ring-highlight ring-inset"
			style={{
				left: box.left,
				top: box.top,
				width: box.width,
				height: box.height,
				transition: "left 120ms, top 120ms, width 120ms, height 120ms",
			}}
		>
			<span className="rounded-md bg-background/90 px-2 py-1 text-[12px] text-foreground shadow-lg">
				Merge group here
			</span>
		</div>,
		document.body,
	);
}
