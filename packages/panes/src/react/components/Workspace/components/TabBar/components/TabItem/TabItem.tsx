import { Button } from "@superset/ui/button";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
} from "@superset/ui/context-menu";
import {
	HoverCard,
	HoverCardContent,
	HoverCardTrigger,
} from "@superset/ui/hover-card";
import { OverflowFadeText } from "@superset/ui/overflow-fade-text";
import { Tooltip, TooltipContent, TooltipTrigger } from "@superset/ui/tooltip";
import { cn } from "@superset/ui/utils";
import { PencilIcon, XIcon } from "lucide-react";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { useDrag, useDrop } from "react-dnd";
import type { Tab } from "../../../../../../../types";
import type { PaneRegistry } from "../../../../../../types";
import { getEmptyDragImage } from "../../../../utils/emptyDragImage";
import { useTabTitle } from "../../../../utils/useTabTitle";
import { PANE_DRAG_TYPE } from "../../../Tab/components/Pane/components/PaneHeader";
import { TabRenameInput } from "./components/TabRenameInput";

export const TAB_DRAG_TYPE = "tab";

interface TabItemProps<TData> {
	tab: Tab<TData>;
	tabs: Tab<TData>[];
	registry: PaneRegistry<TData>;
	index: number;
	isActive: boolean;
	onSelect: () => void;
	onClose: () => void;
	onCloseOthers: () => void;
	onCloseAll: () => void;
	onRename: (title: string | undefined) => void;
	icon?: ReactNode;
	accessory?: ReactNode;
	/** Rows for the multi-pane hover card. Absent for single-pane tabs. */
	paneList?: ReactNode;
}

export function TabItem<TData>({
	tab,
	tabs,
	registry,
	index,
	isActive,
	onSelect,
	onClose,
	onCloseOthers,
	onCloseAll,
	onRename,
	icon,
	accessory,
	paneList,
}: TabItemProps<TData>) {
	const [isEditing, setIsEditing] = useState(false);
	const [editValue, setEditValue] = useState("");
	const title = useTabTitle(tab, tabs, registry);
	const paneCount = Object.keys(tab.panes).length;
	/*
	 * Only the caller's icon — the browser favicon — is drawn on the tab now.
	 * The registry's per-kind `getTabIcon` moved to the hover card's rows, where
	 * there is room for it: a tab is a fixed 160px and the agent mark was
	 * competing with the pane count, the title and the status dot for about 96
	 * pixels. A favicon still earns its place because it identifies a browser
	 * tab better than its title does.
	 */
	// A single-pane tab has nothing to expand, so it keeps the plain tooltip.
	const showPaneList = paneCount > 1 && Boolean(paneList);

	const startEditing = () => {
		setEditValue(title);
		setIsEditing(true);
	};

	const stopEditing = () => {
		setIsEditing(false);
	};

	const saveEdit = () => {
		const nextTitle = editValue.trim();
		if (nextTitle.length === 0) {
			onRename(undefined);
		} else if (nextTitle !== title) {
			onRename(nextTitle);
		}
		stopEditing();
	};

	const nodeRef = useRef<HTMLDivElement>(null);

	const [{ isDragging }, connectDrag, connectDragPreview] = useDrag(
		() => ({
			type: TAB_DRAG_TYPE,
			item: { tabId: tab.id, index },
			collect: (monitor) => ({
				isDragging: monitor.isDragging(),
			}),
		}),
		[tab.id, index],
	);

	// Suppress the browser's default drag image. Chromium snapshots the dragged
	// element, and a tab is a small dark box on a dark surface, so the snapshot
	// reads as a black rectangle stuck to the cursor. The tab already dims and
	// the drop indicator already shows where it will land, so the snapshot adds
	// nothing but the artefact.
	useEffect(() => {
		connectDragPreview(getEmptyDragImage(), { captureDraggingState: true });
	}, [connectDragPreview]);

	// Existing pane-to-tab drop (hovering a pane over a tab switches to it)
	const [{ isOver: isPaneOver }, connectPaneDrop] = useDrop(
		() => ({
			accept: PANE_DRAG_TYPE,
			hover: () => {
				if (!isActive) onSelect();
			},
			collect: (monitor) => ({
				isOver: monitor.isOver(),
			}),
		}),
		[isActive, onSelect],
	);

	const setRef = useCallback(
		(node: HTMLDivElement | null) => {
			(nodeRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
			connectDrag(node);
			connectPaneDrop(node);
		},
		[connectDrag, connectPaneDrop],
	);

	/*
	 * Pulled out of the JSX because it is the trigger for BOTH the plain title
	 * tooltip and the multi-pane hover card, and duplicating it inline was how
	 * the two branches would drift.
	 */
	const titleElement = (
		/* biome-ignore lint/a11y/noStaticElementInteractions: tab selection is handled by the wrapper's mousedown; this title element is intentionally a non-focusable div so clicking a tab never steals focus from the active pane (issue #4967) */
		<div
			className="flex h-full min-w-0 flex-1 items-center gap-1.5 pl-3 pr-1 text-left text-xs transition-colors"
			onAuxClick={(event) => {
				if (event.button === 1) {
					event.preventDefault();
					onClose();
				}
			}}
			onDoubleClick={startEditing}
		>
			{icon && <span className="shrink-0">{icon}</span>}
			{/*
			 * Pane count as a glyph plus a number, in the tab's own text colour.
			 *
			 * The first attempt put an 8px number in a filled chip on the corner of
			 * the pane icon. Two things were wrong with it: at 8px the digit was
			 * below what the rest of the app asks anyone to read, and a coloured
			 * chip sitting a few pixels from the amber status dot read as one
			 * smeared blob rather than two separate signals. So the count is now
			 * monochrome and inherits `currentColor` — the status dot is the only
			 * thing in a tab allowed to use colour, which is what makes it carry.
			 *
			 * The glyph is two overlapping rectangles, the same shape the split
			 * actions use, so it says "panes" instead of leaving a bare number to
			 * be guessed at.
			 */}
			<span className="flex shrink-0 items-center gap-[3px] opacity-70">
				<svg
					aria-hidden="true"
					fill="none"
					height="11"
					stroke="currentColor"
					strokeLinejoin="round"
					strokeWidth="2.2"
					viewBox="0 0 24 24"
					width="11"
				>
					<rect height="12" rx="2" width="12" x="3" y="3" />
					<path d="M9 21h10a2 2 0 0 0 2-2V9" />
				</svg>
				<span className="font-medium text-[10px] leading-none tabular-nums">
					{paneCount}
				</span>
			</span>
			<OverflowFadeText className="flex-1">{title}</OverflowFadeText>
		</div>
	);

	return (
		<ContextMenu>
			<ContextMenuTrigger asChild>
				{/* biome-ignore lint/a11y/noStaticElementInteractions: clicking a tab selects it */}
				{/* biome-ignore lint/a11y/useKeyWithClickEvents: tabs are pointer-driven; keyboard nav is out of scope here */}
				<div
					ref={setRef}
					/*
					 * Shape comes from CSS variables the host sets, the same contract
					 * the panes use. Defaults reproduce the full-height slab with a
					 * divider on its right, so a host that sets nothing is unchanged.
					 *
					 * `--gs-tab-margin` insets the chip from the bar rather than
					 * shortening it with a fixed height: the bar's height is the host's
					 * business, and a hardcoded height here would fight it.
					 */
					style={{
						borderRadius: "var(--gs-tab-radius, 0px)",
						marginTop: "var(--gs-tab-margin, 0px)",
						marginBottom: "var(--gs-tab-margin, 0px)",
						marginInline: "var(--gs-tab-margin-x, 0px)",
						/*
						 * A chip needs an EDGE, not just a fill. Without one the rounded
						 * corners had nothing to describe them and the strip read as flat
						 * text — "you can barely tell they are rounded tabs".
						 *
						 * `borderWidth` is set BEFORE `borderRightWidth` on purpose: the
						 * later key wins, so the slab layout keeps its right-hand divider
						 * after the all-sides width has been applied. The other order
						 * silently deleted the divider from VS Code Style.
						 */
						borderWidth: "var(--gs-tab-border-width, 0px)",
						borderColor: isActive
							? "var(--gs-tab-active-border, transparent)"
							: "transparent",
						borderRightWidth: "var(--gs-tab-divider-width, 1px)",
						/*
						 * The active fill is inline rather than a class BECAUSE it has to
						 * beat the class, and its default is written out longhand as the
						 * exact equivalent of the `bg-border/30` it replaces. Defaulting
						 * it to `transparent` would have silently un-highlighted the
						 * active tab for any host that sets no variables — which is the
						 * whole VS Code Style path.
						 */
						backgroundColor: isActive
							? "var(--gs-tab-active-bg, color-mix(in oklab, var(--border) 30%, transparent))"
							: "var(--gs-tab-idle-bg, transparent)",
					}}
					className={cn(
						"group relative flex h-full w-full items-center border-border transition-colors",
						isActive
							? "text-foreground"
							: "text-muted-foreground/70 hover:bg-tertiary/20 hover:text-muted-foreground",
						isPaneOver && "bg-primary/5",
						isDragging && "opacity-30",
					)}
					// Select on click, not mousedown: the browser suppresses click after a
					// drag, so starting a drag (reorder, or merging a tab into a pane) no
					// longer switches the active tab mid-gesture.
					onClick={() => onSelect()}
				>
					{isEditing ? (
						<div className="flex h-full w-full shrink-0 items-center px-2">
							<TabRenameInput
								className="w-full min-w-0 rounded border border-border bg-background px-1 py-0.5 text-xs text-foreground outline-none focus:ring-1 focus:ring-ring"
								maxLength={64}
								onCancel={stopEditing}
								onChange={setEditValue}
								onSubmit={saveEdit}
								value={editValue}
							/>
						</div>
					) : (
						<>
							{showPaneList ? (
								<HoverCard
									closeDelay={100}
									open={isDragging ? false : undefined}
									openDelay={350}
								>
									<HoverCardTrigger asChild>{titleElement}</HoverCardTrigger>
									<HoverCardContent
										align="start"
										className="w-auto min-w-56 max-w-80 p-1"
										side="bottom"
										sideOffset={2}
									>
										{paneList}
									</HoverCardContent>
								</HoverCard>
							) : (
								<Tooltip
									delayDuration={500}
									open={isDragging ? false : undefined}
								>
									<TooltipTrigger asChild>{titleElement}</TooltipTrigger>
									<TooltipContent side="bottom" showArrow={false}>
										{title}
									</TooltipContent>
								</Tooltip>
							)}
							<div className="relative flex h-full w-7 shrink-0 items-center justify-center">
								{accessory && (
									<span className="pointer-events-none absolute inset-0 flex items-center justify-center leading-none opacity-100 transition-opacity group-hover:opacity-0 group-focus-within:opacity-0">
										{accessory}
									</span>
								)}
								<Button
									aria-label="Close tab"
									className={cn(
										"pointer-events-none size-5 cursor-pointer text-current opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100",
										isActive ? "hover:bg-foreground/10" : "hover:bg-muted",
									)}
									onClick={(event) => {
										event.stopPropagation();
										onClose();
									}}
									onMouseDown={(event) => {
										event.stopPropagation();
									}}
									size="icon"
									type="button"
									variant="ghost"
								>
									<XIcon className="size-3.5" />
								</Button>
							</div>
						</>
					)}
				</div>
			</ContextMenuTrigger>
			<ContextMenuContent>
				<ContextMenuItem onSelect={startEditing}>
					<PencilIcon className="mr-2 size-4" />
					Rename
				</ContextMenuItem>
				<ContextMenuSeparator />
				<ContextMenuItem onSelect={onClose}>
					<XIcon className="mr-2 size-4" />
					Close
				</ContextMenuItem>
				<ContextMenuItem onSelect={onCloseOthers}>Close Others</ContextMenuItem>
				<ContextMenuItem onSelect={onCloseAll}>Close All</ContextMenuItem>
			</ContextMenuContent>
		</ContextMenu>
	);
}
