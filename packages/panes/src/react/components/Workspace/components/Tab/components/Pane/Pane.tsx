import { cn } from "@superset/ui/utils";
import { useCallback, useMemo, useRef, useState } from "react";
import { useDrop } from "react-dnd";
import type { StoreApi } from "zustand/vanilla";
import type { WorkspaceStore } from "../../../../../../../core/store";
import type {
	Pane as PaneType,
	SplitPosition,
	Tab,
} from "../../../../../../../types";
import type {
	ContextMenuActionConfig,
	PaneActionConfig,
	PaneRegistry,
	RendererContext,
} from "../../../../../../types";
import { PaneHeaderActions } from "../../../../../PaneHeaderActions";
import { TAB_DRAG_TYPE } from "../../../TabBar/components/TabItem";
import { PANE_MIN_SIZE_CLASS_NAME } from "../../constants";
import { DropZoneOverlay } from "./components/DropZoneOverlay";
import { PaneContent } from "./components/PaneContent";
import { PaneContextMenu } from "./components/PaneContextMenu";
import { PANE_DRAG_TYPE, PaneHeader } from "./components/PaneHeader";

type PaneDropItem = { paneId: string } | { tabId: string; index: number };

interface PaneComponentProps<TData> {
	store: StoreApi<WorkspaceStore<TData>>;
	tab: Tab<TData>;
	pane: PaneType<TData>;
	isActive: boolean;
	registry: PaneRegistry<TData>;
	parentDirection?: "horizontal" | "vertical" | null;
	paneActions?:
		| PaneActionConfig<TData>[]
		| ((context: RendererContext<TData>) => PaneActionConfig<TData>[]);
	contextMenuActions?:
		| ContextMenuActionConfig<TData>[]
		| ((context: RendererContext<TData>) => ContextMenuActionConfig<TData>[]);
}

function resolveActions<TData, TAction>(
	config:
		| TAction[]
		| ((context: RendererContext<TData>, defaults: TAction[]) => TAction[])
		| undefined,
	context: RendererContext<TData>,
	defaults: TAction[],
): TAction[] {
	if (!config) return defaults;
	if (typeof config === "function") return config(context, defaults);
	return config;
}

function getDropPosition(
	clientX: number,
	clientY: number,
	rect: DOMRect,
): SplitPosition {
	const cx = rect.left + rect.width / 2;
	const cy = rect.top + rect.height / 2;
	const dx = clientX - cx;
	const dy = clientY - cy;
	if (Math.abs(dx) > Math.abs(dy)) {
		return dx > 0 ? "right" : "left";
	}
	return dy > 0 ? "bottom" : "top";
}

export function Pane<TData>({
	store,
	tab,
	pane,
	isActive,
	registry,
	parentDirection = null,
	paneActions,
	contextMenuActions,
}: PaneComponentProps<TData>) {
	const definition = registry[pane.kind];

	const tabs = store.getState().tabs;
	const tabPosition = tabs.findIndex((t) => t.id === tab.id);

	const context: RendererContext<TData> = useMemo(() => {
		const ctx: RendererContext<TData> = {
			pane: { ...pane, parentDirection },
			tab: { ...tab, position: tabPosition },
			isActive,
			store,
			actions: {
				close: async () => {
					if (definition?.onBeforeClose) {
						const allowed = await definition.onBeforeClose(pane);
						if (!allowed) return;
					}
					store.getState().closePane({ tabId: tab.id, paneId: pane.id });
				},
				focus: () =>
					store.getState().setActivePane({ tabId: tab.id, paneId: pane.id }),
				setTitle: (title?: string) =>
					store.getState().setPaneTitleOverride({
						tabId: tab.id,
						paneId: pane.id,
						titleOverride: title,
					}),
				pin: () =>
					store.getState().setPanePinned({
						paneId: pane.id,
						pinned: true,
					}),
				updateData: (data: TData) =>
					store.getState().setPaneData({ paneId: pane.id, data }),
				split: (position, newPane) =>
					store.getState().splitPane({
						tabId: tab.id,
						paneId: pane.id,
						position: position === "down" ? "bottom" : "right",
						newPane,
					}),
			},
			components: { PaneHeaderActions: () => null },
		};

		// Resolve workspace-level actions (or empty if not provided)
		const workspaceResolved =
			typeof paneActions === "function"
				? paneActions(ctx)
				: (paneActions ?? []);

		// Definition can override or modify workspace actions
		const finalActions = resolveActions(
			definition?.paneActions,
			ctx,
			workspaceResolved,
		);

		ctx.components.PaneHeaderActions = () => (
			<PaneHeaderActions actions={finalActions} context={ctx} />
		);

		return ctx;
	}, [
		pane,
		tab,
		isActive,
		store,
		definition,
		paneActions,
		parentDirection,
		tabPosition,
	]);

	const resolvedContextMenuActions = useMemo(() => {
		const workspaceResolved =
			typeof contextMenuActions === "function"
				? contextMenuActions(context)
				: (contextMenuActions ?? []);

		return resolveActions(
			definition?.contextMenuActions,
			context,
			workspaceResolved,
		);
	}, [context, contextMenuActions, definition]);

	const dropPositionRef = useRef<SplitPosition | null>(null);
	const [dropPosition, setDropPosition] = useState<SplitPosition | null>(null);
	const dropRef = useRef<HTMLDivElement>(null);
	/** The pane's box, measured once per hover. See the hover handler. */
	const hoverRectRef = useRef<DOMRect | null>(null);

	const [{ isOver, canDrop }, connectDrop] = useDrop(
		() => ({
			accept: [PANE_DRAG_TYPE, TAB_DRAG_TYPE],
			canDrop: (item: PaneDropItem, monitor) => {
				// Can't drop a tab onto a pane it already owns, or a pane onto itself.
				if (monitor.getItemType() === TAB_DRAG_TYPE) {
					return "tabId" in item && item.tabId !== tab.id;
				}
				return "paneId" in item && item.paneId !== pane.id;
			},
			hover: (_item, monitor) => {
				const offset = monitor.getClientOffset();
				const el = dropRef.current;
				if (!offset || !el) return;

				// Measure ONCE per hover, not once per mousemove.
				//
				// getBoundingClientRect forces a synchronous layout, and this fires on
				// every pointer move over the pane. With a terminal or a session view
				// inside, that layout is not cheap, and paying it sixty-plus times a
				// second is what made dragging feel heavy. A pane cannot move or
				// resize while a drag is in progress, so the first measurement stays
				// correct for the whole hover; it is cleared when the pointer leaves
				// (see the isOver reset below).
				let rect = hoverRectRef.current;
				if (!rect) {
					rect = el.getBoundingClientRect();
					hoverRectRef.current = rect;
				}

				const pos = getDropPosition(offset.x, offset.y, rect);
				if (pos !== dropPositionRef.current) {
					dropPositionRef.current = pos;
					setDropPosition(pos);
				}
			},
			drop: (item: PaneDropItem, monitor) => {
				const pos = dropPositionRef.current;
				if (!pos) return;
				if (monitor.getItemType() === TAB_DRAG_TYPE && "tabId" in item) {
					store.getState().moveTabToSplit({
						sourceTabId: item.tabId,
						targetPaneId: pane.id,
						position: pos,
					});
					return;
				}
				if ("paneId" in item) {
					store.getState().movePaneToSplit({
						sourcePaneId: item.paneId,
						targetPaneId: pane.id,
						position: pos,
					});
				}
			},
			collect: (monitor) => ({
				isOver: monitor.isOver(),
				canDrop: monitor.canDrop(),
			}),
		}),
		[pane.id, tab.id, store],
	);

	// Merge refs: connectDrop needs a node, and we need dropRef for rect calculations
	const setRefs = useCallback(
		(node: HTMLDivElement | null) => {
			(dropRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
			connectDrop(node);
		},
		[connectDrop],
	);

	// Clear drop position when not hovering. The cached rect goes with it, so a
	// pane that is resized between two drags is measured afresh on the next one.
	if (!isOver) {
		hoverRectRef.current = null;
		if (dropPositionRef.current !== null) {
			dropPositionRef.current = null;
			if (dropPosition !== null) setDropPosition(null);
		}
	}

	/**
	 * The pane's own contents, kept off the drag path.
	 *
	 * `renderPane` used to be called inline in the JSX, so every re-render of
	 * this component re-invoked it — and dragging re-renders constantly, because
	 * `isOver`, `canDrop` and `dropPosition` all change as the pointer moves
	 * between panes. That meant a terminal or a whole session view was rebuilt
	 * and reconciled while the user was only moving the mouse, which is the bulk
	 * of what made dragging feel heavy.
	 *
	 * Memoised on `context`, which is itself memoised on the pane's real inputs.
	 * Drag state is deliberately NOT among them, so a hover changes the drop
	 * indicator and nothing else: React sees the identical element and skips the
	 * subtree entirely.
	 */
	const content = useMemo(
		() =>
			definition ? (
				definition.renderPane(context)
			) : (
				<div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
					Unknown pane kind: {pane.kind}
				</div>
			),
		[definition, context, pane.kind],
	);

	const title = definition
		? (pane.titleOverride ?? definition.getTitle?.(pane) ?? pane.id)
		: `Unknown: ${pane.kind}`;
	const icon = definition?.getIcon?.(context);
	const titleContent = definition?.renderTitle?.(context);
	const headerExtras = definition?.renderHeaderExtras?.(context);
	const toolbar = definition?.renderToolbar?.(context);

	const isDropTarget = isOver && canDrop;

	// Expand/restore control: only meaningful when the tab has more than one
	// pane. Maximizing renders just this pane fullscreen (see Tab.tsx).
	const paneCount = Object.keys(tab.panes).length;
	const isMaximized = tab.maximizedPaneId === pane.id;
	// Resolved once and shared: the header fills with it and the active-pane
	// ring below traces it, so the two cannot drift apart. They previously did —
	// the ring was hardcoded to `--highlight` (#e07850) while Claude's header
	// painted #d97757, a near-miss that reads as a rendering fault.
	const accent = definition?.getAccent?.(context);
	const maximizeControl =
		paneCount > 1 ? (
			<button
				type="button"
				title={isMaximized ? "Restore" : "Expand"}
				aria-label={isMaximized ? "Restore pane" : "Expand pane"}
				className="rounded p-0.5 text-muted-foreground/60 transition-colors hover:text-muted-foreground"
				onMouseDown={(e) => e.stopPropagation()}
				onClick={(e) => {
					e.stopPropagation();
					store
						.getState()
						.toggleMaximizePane({ tabId: tab.id, paneId: pane.id });
				}}
			>
				{isMaximized ? (
					<svg
						width="13"
						height="13"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
						strokeLinejoin="round"
						aria-hidden="true"
					>
						<path d="M4 14h6v6" />
						<path d="M20 10h-6V4" />
						<path d="M14 10l7-7" />
						<path d="M3 21l7-7" />
					</svg>
				) : (
					<svg
						width="13"
						height="13"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
						strokeLinejoin="round"
						aria-hidden="true"
					>
						<path d="M15 3h6v6" />
						<path d="M9 21H3v-6" />
						<path d="M21 3l-7 7" />
						<path d="M3 21l7-7" />
					</svg>
				)}
			</button>
		) : null;

	return (
		<PaneContextMenu actions={resolvedContextMenuActions} context={context}>
			{/* biome-ignore lint/a11y/noStaticElementInteractions: clicking anywhere in a pane focuses it (standard IDE behavior) */}
			<div
				ref={setRefs}
				className={cn(
					"relative flex h-full w-full flex-col overflow-hidden",
					PANE_MIN_SIZE_CLASS_NAME,
					// The active-pane ring is painted by an overlay further down,
					// NOT by a class here. `ring-inset` renders as an inset
					// box-shadow, which paints above this element's own background
					// but BELOW its descendants — and every pane body carries its
					// own `bg-background`, with the header carrying the accent fill.
					// So the ring that used to live here was covered on all four
					// edges and had never actually been visible.
				)}
				onMouseDown={context.actions.focus}
			>
				<PaneHeader
					title={title}
					icon={icon}
					isActive={isActive}
					titleContent={titleContent}
					headerExtras={headerExtras}
					toolbar={toolbar}
					maximizeControl={maximizeControl}
					actionsContent={<context.components.PaneHeaderActions />}
					paneId={pane.id}
					onClick={
						definition?.onHeaderClick
							? () => definition.onHeaderClick?.(context)
							: context.actions.pin
					}
					onMiddleClick={context.actions.close}
					onRename={context.actions.setTitle}
					accent={accent}
				/>
				<PaneContent>{content}</PaneContent>
				{/*
				 * The active-pane ring.
				 *
				 * An overlay rather than a class on the container, because an
				 * inset box-shadow paints UNDER descendants and every pane body
				 * has its own background — which is why the previous
				 * `ring-2 ring-highlight ring-inset` was never visible. Rendered
				 * last and absolutely positioned so it sits above the content it
				 * frames, and `pointer-events-none` so it cannot eat a click.
				 *
				 * Both shadows are INSET on purpose. An outer glow would be
				 * clipped by this container's `overflow-hidden` and by the
				 * resizable panel around it, so the softer band is drawn just
				 * inside the solid edge instead — same bloom, nothing cropped.
				 *
				 * Shown whenever the pane is active, including when it is the
				 * only one. It used to be gated on `paneCount > 1`, on the
				 * reasoning that a lone pane needs no disambiguating; but a frame
				 * that appears and vanishes with pane count is its own puzzle,
				 * and the colour still says WHICH agent has the keyboard.
				 */}
				{isActive && (
					<div
						aria-hidden="true"
						className="pointer-events-none absolute inset-0 z-30 rounded-[inherit]"
						style={{
							boxShadow: `inset 0 0 0 2px ${
								accent ?? "var(--highlight)"
							}, inset 0 0 0 5px ${
								accent
									? `color-mix(in oklab, ${accent} 22%, transparent)`
									: "transparent"
							}`,
						}}
					/>
				)}
				{isDropTarget && <DropZoneOverlay position={dropPosition} />}
			</div>
		</PaneContextMenu>
	);
}
