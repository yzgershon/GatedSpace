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
				const rect = el.getBoundingClientRect();
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

	// Clear drop position when not hovering
	if (!isOver && dropPositionRef.current !== null) {
		dropPositionRef.current = null;
		if (dropPosition !== null) setDropPosition(null);
	}

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
					// Highlight the focused pane so the user can see which agent
					// their keyboard is driving — only when it's ambiguous (more
					// than one pane visible in the tab).
					isActive &&
						paneCount > 1 &&
						!isMaximized &&
						"ring-2 ring-highlight ring-inset",
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
				/>
				<PaneContent>
					{definition ? (
						definition.renderPane(context)
					) : (
						<div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
							Unknown pane kind: {pane.kind}
						</div>
					)}
				</PaneContent>
				{isDropTarget && <DropZoneOverlay position={dropPosition} />}
			</div>
		</PaneContextMenu>
	);
}
