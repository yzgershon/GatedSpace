import { renameSessionTab } from "renderer/lib/session-names";
import { BrowserTabIcon } from "../../hooks/usePaneRegistry/components/BrowserPane/BrowserTabIcon";
/** Fixed tab targets; only the selected tab shows its inline title.
 * Hover and keyboard focus reveal a name card below the rail without moving
 * neighboring targets. Pointer-based reorder and pane merge remain separate.
 */

import type { LayoutNode, PaneRegistry, WorkspaceStore } from "@superset/panes";
import { PANE_DRAG_TYPE, resolveTabTitle } from "@superset/panes";
import {
	HoverCard,
	HoverCardContent,
	HoverCardTrigger,
} from "@superset/ui/hover-card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@superset/ui/tooltip";
import { cn } from "@superset/ui/utils";
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { useDrop } from "react-dnd";
import { createPortal } from "react-dom";
import { LuChevronLeft, LuChevronRight, LuPlus, LuX } from "react-icons/lu";
import { getStatusTooltip } from "renderer/components/StatusIndicator";
import { useV2SourcesNotificationStatus } from "renderer/hooks/host-service/useV2NotificationStatus";
import { useWorkspace } from "renderer/routes/_authenticated/_dashboard/v2-workspace/providers/WorkspaceProvider";
import { getV2NotificationSourcesForTab } from "renderer/stores/v2-notifications";
import { useStore } from "zustand";
import type { StoreApi } from "zustand/vanilla";
import type { BrowserPaneData, PaneViewerData } from "../../types";
import { AgentStatusRing } from "./components/AgentStatusRing";
import { computeSlideOffset, overlayRect } from "./tabRailDrag";
import {
	NO_DRAG_ATTRIBUTE,
	type PaneDropTarget,
	type TabRailDrag,
	useTabRailDrag,
} from "./useTabRailDrag";
import { useTabRailHover } from "./useTabRailHover";
import { useTabRailOverflow } from "./useTabRailOverflow";
import { useTabThumbnails } from "./useTabThumbnails";

import "./tab-rail.css";

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
	 * Closes a group through the SAME path the strip's Ã— used.
	 *
	 * Not `store.removeTab` directly: that skips `onBeforeCloseTab`, which is
	 * the dirty-tab guard. A group holding a half-written prompt would close
	 * without asking, and the prompt is not recoverable.
	 */
	onCloseGroup: (tabId: string) => void;
}

function TabRailItem({
	tab,
	tabs,
	index,
	registry,
	isActive,
	isExpanded,
	showName,
	thumbnail,
	onPreviewEnter,
	onPreviewLeave,
	onDismissPreview,
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
	isExpanded: boolean;
	showName: boolean;
	thumbnail?: string;
	onPreviewEnter: () => void;
	onPreviewLeave: () => void;
	onDismissPreview: () => void;
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
	const icon = facePane ? (
		facePane.kind === "browser" ? (
			<BrowserTabIcon data={facePane.data as BrowserPaneData} />
		) : (
			registry[facePane.kind]?.getTabIcon?.(facePane)
		)
	) : null;
	const title = resolveTabTitle(tab, tabs, registry);

	// The word, not just the colour â€” this is the accessible name and the
	// tooltip both, so status survives for anyone who cannot read the ring.
	const statusWord = status ? getStatusTooltip(status) : null;
	const label = statusWord ? `${title} â€” ${statusWord}` : title;

	/*
	 * The chip's own drag state, derived from the rail's single session.
	 *
	 * Held by the PARENT, not here: opening a gap means moving the chips this
	 * one is passing, and a per-item handler can only see itself. That is why
	 * the old version could not animate anything â€” it mutated store order on
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
	const labelRef = useRef<HTMLSpanElement>(null);
	const [labelWidth, setLabelWidth] = useState(0);
	// biome-ignore lint/correctness/useExhaustiveDependencies: Text changes can keep collapsed child boxes at zero width, so they must remeasure explicitly.
	useLayoutEffect(() => {
		const label = labelRef.current;
		if (!label) return;
		const measure = () => {
			const children = [...label.children] as HTMLElement[];
			const gap = Number.parseFloat(getComputedStyle(label).columnGap) || 0;
			setLabelWidth(
				Math.min(
					320,
					Math.ceil(
						children.reduce((sum, child) => {
							const range = document.createRange();
							range.selectNodeContents(child);
							return sum + range.getBoundingClientRect().width;
						}, 0) +
							gap * Math.max(0, children.length - 1),
					),
				),
			);
		};
		measure();
		const observer = new ResizeObserver(measure);
		for (const child of label.children) observer.observe(child);
		return () => observer.disconnect();
	}, [title, paneCount]);

	return (
		<HoverCard open={showName && !drag.state}>
			<HoverCardTrigger asChild>
				<div
					ref={nodeRef}
					data-active={isActive}
					data-expanded={isExpanded}
					data-hovered={showName}
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
						 * The lifted chip tracks the pointer 1:1 â€” a transition here
						 * would put it behind the finger, which is precisely the lag
						 * that makes a drag feel cheap. Everything else eases, because
						 * a gap opening instantly reads as a glitch rather than as room
						 * being made.
						 */
						transitionProperty: isDragged
							? "box-shadow, opacity"
							: "transform, background-color, color, box-shadow",
						transitionDuration: isDragged ? "120ms" : "180ms",
						transitionTimingFunction: "cubic-bezier(0.2, 0.8, 0.2, 1)",
						zIndex: isDragged ? 2 : undefined,
						cursor: isDragged ? "grabbing" : undefined,
					}}
					className={cn(
						// `duration-100` rather than the 150ms default: hovering a tab
						// should feel like the pointer landed on it, not like the app
						// noticed a moment later.
						"gs-tabrail-tab no-drag relative flex h-10 shrink-0 items-center rounded-[10px] duration-100",
						// Lifted: a shadow under it and a brighter edge, so it reads as
						// picked UP rather than merely displaced.
						isDragged &&
							"shadow-[0_10px_24px_-8px_rgba(0,0,0,0.85)] ring-1 ring-highlight/50",
						// Over a pane the chip is no longer the thing being placed â€”
						// the overlay is â€” so it steps back rather than competing.
						isDragged && overPane && "opacity-45",
						isActive
							? "bg-card text-foreground"
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
						 * `display: none`, so it stays a flex item â€” a gap would pad every
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
						<AgentStatusRing status={status}>{icon}</AgentStatusRing>
						<span
							ref={labelRef}
							style={{ maxWidth: isExpanded ? labelWidth : 0 }}
							className="gs-tabrail-label flex items-center gap-1.5"
						>
							<span className="whitespace-nowrap">
								{Array.from(title).length > 15
									? `${Array.from(title).slice(0, 15).join("")}...`
									: title}
							</span>
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
					 * Moving the âœ• to the lead fixed that and broke the look: it read
					 * as a stray mark floating in front of the tab, and the 20px it
					 * claimed on every open tab pushed the rail into an overflow it
					 * could not scroll out of.
					 *
					 * The active tab is ALREADY expanded, so hovering it moves nothing
					 * and the button cannot arrive under a stationary cursor. Every
					 * other tab keeps middle-click, which is what the strip always had.
					 */}
					<button
						type="button"
						/*
						 * Not a drag handle. The chip as a whole is, so without this
						 * the âœ• would begin a drag on press and its click would then
						 * be swallowed as drag fallout.
						 */
						{...{ [NO_DRAG_ATTRIBUTE]: "" }}
						aria-label={`Close ${title}`}
						disabled={!isExpanded || !isActive}
						tabIndex={isExpanded && isActive ? 0 : -1}
						aria-hidden={!isExpanded || !isActive}
						className="gs-tabrail-close flex size-[17px] shrink-0 items-center justify-center rounded text-muted-foreground/55 hover:bg-foreground/10 hover:text-foreground focus-visible:outline-none"
						onClick={(event) => {
							event.stopPropagation();
							onCloseGroup(tab.id);
						}}
					>
						<LuX className="size-3.5" />
					</button>
				</div>
			</HoverCardTrigger>
			<HoverCardContent
				side="bottom"
				sideOffset={10}
				collisionPadding={8}
				className="gs-tabrail-namecard"
				onPointerEnter={onPreviewEnter}
				onPointerLeave={onPreviewLeave}
				onEscapeKeyDown={onDismissPreview}
			>
				<div className="gs-tabrail-preview-heading">
					<span className="gs-tabrail-preview-icon">{icon}</span>
					<span className="gs-tabrail-namecard-title">{title}</span>
					<button
						type="button"
						aria-label={`Close ${title} from preview`}
						onClick={() => {
							onDismissPreview();
							onCloseGroup(tab.id);
						}}
					>
						<LuX size={15} />
					</button>
				</div>
				<button
					type="button"
					className="gs-tabrail-thumbnail"
					aria-label={`Open ${title}`}
					onClick={() => {
						onDismissPreview();
						onSelect(tab.id);
					}}
				>
					{thumbnail ? (
						<img
							src={thumbnail}
							alt={`Last viewed ${title}`}
							draggable={false}
						/>
					) : (
						<TabLayoutThumbnail
							layout={tab.layout}
							tab={tab}
							registry={registry}
						/>
					)}
				</button>
			</HoverCardContent>
		</HoverCard>
	);
}

function TabLayoutThumbnail({
	layout,
	tab,
	registry,
}: {
	layout: LayoutNode;
	tab: WorkspaceStore<PaneViewerData>["tabs"][number];
	registry: PaneRegistry<PaneViewerData>;
}) {
	if (layout.type === "split")
		return (
			<span className="gs-tabrail-mini-split" data-direction={layout.direction}>
				<span style={{ flex: layout.splitPercentage ?? 50 }}>
					<TabLayoutThumbnail
						layout={layout.first}
						tab={tab}
						registry={registry}
					/>
				</span>
				<span style={{ flex: 100 - (layout.splitPercentage ?? 50) }}>
					<TabLayoutThumbnail
						layout={layout.second}
						tab={tab}
						registry={registry}
					/>
				</span>
			</span>
		);
	const pane = tab.panes[layout.paneId];
	if (!pane) return null;
	return (
		<span className="gs-tabrail-mini-pane">
			<span>
				{registry[pane.kind]?.getTabIcon?.(pane)}
				{pane.titleOverride ??
					registry[pane.kind]?.getTitle?.(pane) ??
					pane.kind}
			</span>
		</span>
	);
}

export function TabRail({
	store,
	registry,
	onNewGroup,
	newGroupHint,
	onCloseGroup,
}: TabRailProps) {
	const { workspace } = useWorkspace();
	const tabs = useStore(store, (s) => s.tabs);
	const activeTabId = useStore(store, (s) => s.activeTabId);
	const thumbnails = useTabThumbnails(
		workspace.id,
		activeTabId,
		tabs.map((tab) => tab.id),
	);

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
	const [focusedTabId, setFocusedTabId] = useState<string | null>(null);
	const hover = useTabRailHover();
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
	const { scrollRef, edges, step } = useTabRailOverflow(
		activeTabId,
		tabs.length,
		Boolean(renamingTabId),
		activeTabId,
	);
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
		const tab = store.getState().tabs.find((item) => item.id === tabId);
		if (tab && renameSessionTab(tab, registry, next || undefined)) return;
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
			onPointerEnter={() => void thumbnails.capture()}
			className={cn(
				/*
				 * A border that survives the well.
				 *
				 * `--border` (#2a2827) at 65% over a #0d0a09 ground lands around
				 * #1e1c1b, which is a nine-value step and effectively invisible â€”
				 * the same "under 10% is not a step" problem the pane surface hit.
				 * Lifting it toward white gives the floating objects an edge you can
				 * find, and the presets bar uses the identical value so the two read
				 * as the same kind of thing.
				 */
				/*
				 * `h-[46px]`, the same row the agents surface sits on. It used to size
				 * itself from its contents (36px tabs + 3px padding = 42px), which
				 * put it two pixels off the launcher across the bar â€” near enough to
				 * look like a rendering difference rather than a decision.
				 */
				"gs-tabrail no-drag flex h-[50px] min-w-0 items-center gap-[3px] rounded-[13px] border border-[color-mix(in_oklab,var(--border)_100%,white_14%)] bg-[rgba(13,10,9,0.72)] p-[3px]",
				"shadow-[0_6px_20px_-10px_rgba(0,0,0,0.9)] transition-colors",
				// Mid-drag the rail stops being a list and starts being a target,
				// and says which of the two it currently is.
				canDrop && "ring-1 ring-highlight/40",
				isOver && "bg-highlight/15 ring-1 ring-highlight",
			)}
		>
			<div
				className="gs-tabrail-window"
				data-fade-left={edges.left}
				data-fade-right={edges.right}
				onPointerEnter={hover.cancel}
				onPointerLeave={hover.leave}
			>
				<div
					ref={scrollRef}
					className="gs-tabrail-scroll"
					role="toolbar"
					aria-label="Session tabs"
					onPointerDownCapture={() => {
						hover.clear();
						setFocusedTabId(null);
					}}
					onScroll={hover.clear}
					onPointerMove={(event) => {
						if (event.pointerType !== "mouse" || event.buttons || drag.state)
							return;
						const id =
							(event.target as HTMLElement).closest<HTMLElement>(
								"[data-rail-tab]",
							)?.dataset.railTab ?? null;
						hover.move(id, event.clientX, event.clientY);
					}}
					onFocusCapture={(event) => {
						hover.clear();
						if (!(event.target as HTMLElement).matches(":focus-visible"))
							return;
						setFocusedTabId(
							(event.target as HTMLElement).closest<HTMLElement>(
								"[data-rail-tab]",
							)?.dataset.railTab ?? null,
						);
					}}
					onBlurCapture={(event) => {
						if (
							!event.currentTarget.contains(event.relatedTarget as Node | null)
						)
							setFocusedTabId(null);
					}}
					onKeyDown={(event) => {
						if (event.key === "Escape") {
							hover.clear();
							setFocusedTabId(null);
							return;
						}
						if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
							return;
						const buttons = [
							...event.currentTarget.querySelectorAll<HTMLButtonElement>(
								"[data-rail-tab] > button:first-of-type",
							),
						];
						const current = (event.target as HTMLElement)
							.closest("[data-rail-tab]")
							?.querySelector<HTMLButtonElement>("button");
						const index = buttons.indexOf(current as HTMLButtonElement);
						if (index < 0) return;
						event.preventDefault();
						const next =
							event.key === "Home"
								? 0
								: event.key === "End"
									? buttons.length - 1
									: event.key === "ArrowRight"
										? (index + 1) % buttons.length
										: (index + buttons.length - 1) % buttons.length;
						hover.clear();
						buttons[next]?.focus();
					}}
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
								isExpanded={tab.id === activeTabId}
								showName={tab.id === (hover.hoveredId ?? focusedTabId)}
								thumbnail={thumbnails.images.get(tab.id)}
								onPreviewEnter={hover.cancel}
								onPreviewLeave={hover.leave}
								onDismissPreview={() => {
									hover.clear();
									setFocusedTabId(null);
								}}
								drag={drag}
								onSelect={selectTab}
								onCloseGroup={onCloseGroup}
								onStartRename={startRename}
							/>
						))
					)}
				</div>
			</div>
			<div className="gs-tabrail-fixed">
				<div className="gs-tabrail-arrows" hidden={!edges.left && !edges.right}>
					<button
						type="button"
						className="gs-tabrail-control"
						aria-label="Previous tabs"
						title="Previous tabs"
						disabled={!edges.left}
						onClick={() => step(-1)}
					>
						<LuChevronLeft size={15} />
					</button>
					<button
						type="button"
						className="gs-tabrail-control"
						aria-label="Next tabs"
						title="Next tabs"
						disabled={!edges.right}
						onClick={() => step(1)}
					>
						<LuChevronRight size={15} />
					</button>
				</div>
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
						{newGroupHint ? `New group Â· ${newGroupHint}` : "New group"}
					</TooltipContent>
				</Tooltip>
			</div>
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
 * same capability into something you can aim, and â€” more to the point â€” see
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
