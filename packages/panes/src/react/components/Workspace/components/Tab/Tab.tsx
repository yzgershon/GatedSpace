import {
	ResizableHandle,
	ResizablePanel,
	ResizablePanelGroup,
} from "@superset/ui/resizable";
import { useEffect, useRef } from "react";
import type { StoreApi } from "zustand/vanilla";
import type { WorkspaceStore } from "../../../../../core/store";
import type {
	LayoutNode,
	SplitPath,
	Tab as TabType,
} from "../../../../../types";
import type {
	ContextMenuActionConfig,
	PaneActionConfig,
	PaneRegistry,
	RendererContext,
} from "../../../../types";
import { Pane } from "./components/Pane";
import { PANE_MIN_SIZE_CLASS_NAME } from "./constants";

interface TabProps<TData> {
	store: StoreApi<WorkspaceStore<TData>>;
	tab: TabType<TData>;
	registry: PaneRegistry<TData>;
	paneActions?:
		| PaneActionConfig<TData>[]
		| ((context: RendererContext<TData>) => PaneActionConfig<TData>[]);
	contextMenuActions?:
		| ContextMenuActionConfig<TData>[]
		| ((context: RendererContext<TData>) => ContextMenuActionConfig<TData>[]);
	onSplitResizeDragging?: (sourceId: string, isDragging: boolean) => void;
}

function SplitView<TData>({
	store,
	tab,
	node,
	path,
	registry,
	paneActions,
	contextMenuActions,
	onSplitResizeDragging,
}: {
	store: StoreApi<WorkspaceStore<TData>>;
	tab: TabType<TData>;
	node: Extract<LayoutNode, { type: "split" }>;
	path: SplitPath;
	registry: PaneRegistry<TData>;
	paneActions?: TabProps<TData>["paneActions"];
	contextMenuActions?: TabProps<TData>["contextMenuActions"];
	onSplitResizeDragging?: TabProps<TData>["onSplitResizeDragging"];
}) {
	const groupRef = useRef<React.ComponentRef<typeof ResizablePanelGroup>>(null);
	const firstSize = node.splitPercentage ?? 50;
	const secondSize = 100 - firstSize;
	const resizeSourceId = `${tab.id}:${path.join(".") || "root"}`;

	useEffect(() => {
		return () => {
			onSplitResizeDragging?.(resizeSourceId, false);
		};
	}, [onSplitResizeDragging, resizeSourceId]);

	return (
		<ResizablePanelGroup
			ref={groupRef}
			className="min-h-full min-w-full overflow-auto"
			direction={node.direction}
			onLayout={(sizes) => {
				if (sizes[0] != null) {
					store.getState().resizeSplit({
						tabId: tab.id,
						path,
						splitPercentage: sizes[0],
					});
				}
			}}
		>
			<ResizablePanel
				className={PANE_MIN_SIZE_CLASS_NAME}
				defaultSize={firstSize}
			>
				<LayoutNodeView
					store={store}
					tab={tab}
					node={node.first}
					path={[...path, "first"]}
					registry={registry}
					paneActions={paneActions}
					contextMenuActions={contextMenuActions}
					onSplitResizeDragging={onSplitResizeDragging}
					parentDirection={node.direction}
				/>
			</ResizablePanel>
			<ResizableHandle
				/*
				 * The hairline between two panes, off by default under a skin that
				 * separates them with a GUTTER instead.
				 *
				 * `ResizableHandle` ships `bg-border`, so every split drew a 1px grey
				 * rule down the middle of an 18px gap that already said the same
				 * thing — two boundaries for one edge, which is what stops the cards
				 * reading as floating. It stays fully draggable and comes back on
				 * hover, so the affordance is not lost, only the permanent line.
				 *
				 * A CSS variable rather than a token lookup: this package is shared
				 * and must not import a desktop-only hook.
				 */
				className="bg-[var(--gs-split-handle,var(--border))] transition-colors hover:bg-border data-[resize-handle-state=drag]:bg-border"
				onDragging={(isDragging) =>
					onSplitResizeDragging?.(resizeSourceId, isDragging)
				}
				onDoubleClick={(e) => {
					e.stopPropagation();
					groupRef.current?.setLayout([50, 50]);
				}}
			/>
			<ResizablePanel
				className={PANE_MIN_SIZE_CLASS_NAME}
				defaultSize={secondSize}
			>
				<LayoutNodeView
					store={store}
					tab={tab}
					node={node.second}
					path={[...path, "second"]}
					registry={registry}
					paneActions={paneActions}
					contextMenuActions={contextMenuActions}
					onSplitResizeDragging={onSplitResizeDragging}
					parentDirection={node.direction}
				/>
			</ResizablePanel>
		</ResizablePanelGroup>
	);
}

function LayoutNodeView<TData>({
	store,
	tab,
	node,
	path,
	registry,
	paneActions,
	contextMenuActions,
	onSplitResizeDragging,
	parentDirection = null,
}: {
	store: StoreApi<WorkspaceStore<TData>>;
	tab: TabType<TData>;
	node: LayoutNode;
	path: SplitPath;
	registry: PaneRegistry<TData>;
	paneActions?: TabProps<TData>["paneActions"];
	contextMenuActions?: TabProps<TData>["contextMenuActions"];
	onSplitResizeDragging?: TabProps<TData>["onSplitResizeDragging"];
	parentDirection?: "horizontal" | "vertical" | null;
}) {
	// A persisted layout can be malformed — a split node with a missing
	// child, or a corrupt node shape from an older schema. Render nothing
	// rather than crashing the whole renderer on `node.type` of undefined.
	if (!node || (node.type !== "pane" && node.type !== "split")) {
		return null;
	}

	if (node.type === "pane") {
		const pane = tab.panes[node.paneId];
		if (!pane) return null;

		/*
		 * The inset is HALF the intended gutter, applied to every leaf, so two
		 * adjacent panes each contribute half and the space between them comes
		 * out right. The tab root adds the same inset again so the outer edge
		 * matches the inner gaps instead of being half of them.
		 */
		return (
			<div className="h-full w-full p-[var(--gs-pane-inset,0px)]">
				{/*
				 * KEYED BY PANE ID, and this is load-bearing state isolation rather
				 * than a render optimisation.
				 *
				 * Without a key React reconciles by POSITION. Change the layout —
				 * open a terminal, split, close a pane, switch tab — and the element
				 * at a given slot can be a different pane than it was last render;
				 * React keeps the existing component instance and only swaps the
				 * props. `useState` initialisers do not re-run on that path, so
				 * every piece of local state inside a pane silently
				 * becomes the NEXT pane's state.
				 *
				 * That is exactly what was reported twice: a half-written prompt
				 * appearing in a different pane in a different tab, and a
				 * half-written prompt vanishing. Both are one bug. The composer
				 * seeds its text from the draft store on MOUNT, so a reused
				 * instance carries pane A's text into pane B, and the mirror
				 * effect then writes that text under B's key — or writes B's empty
				 * box under A's, which deletes A's draft.
				 *
				 * The key makes pane identity a reconciliation boundary, so a
				 * different pane is always a different instance.
				 */}
				<Pane
					key={pane.id}
					store={store}
					tab={tab}
					pane={pane}
					isActive={tab.activePaneId === pane.id}
					registry={registry}
					paneActions={paneActions}
					contextMenuActions={contextMenuActions}
					parentDirection={parentDirection}
				/>
			</div>
		);
	}

	return (
		<SplitView
			store={store}
			tab={tab}
			node={node}
			path={path}
			registry={registry}
			paneActions={paneActions}
			contextMenuActions={contextMenuActions}
			onSplitResizeDragging={onSplitResizeDragging}
		/>
	);
}

export function Tab<TData>({
	store,
	tab,
	registry,
	paneActions,
	contextMenuActions,
	onSplitResizeDragging,
}: TabProps<TData>) {
	if (!tab.layout) {
		return (
			<div className="flex min-h-0 min-w-0 flex-1 items-center justify-center text-sm text-muted-foreground">
				No panes open
			</div>
		);
	}

	// When a pane is maximized, render only that pane fullscreen and skip the
	// split layout entirely. A stale maximizedPaneId (pane already gone) falls
	// through to the normal layout.
	const maximizedPane = tab.maximizedPaneId
		? tab.panes[tab.maximizedPaneId]
		: null;
	if (maximizedPane) {
		return (
			<div className="flex h-full w-full min-h-0 min-w-0 flex-1 overflow-auto bg-[var(--gs-pane-well,transparent)] p-[var(--gs-pane-inset,0px)]">
				{/* Keyed for the same reason as the leaf above: maximizing swaps
				    which pane occupies this slot. */}
				<Pane
					key={maximizedPane.id}
					store={store}
					tab={tab}
					pane={maximizedPane}
					isActive={tab.activePaneId === maximizedPane.id}
					registry={registry}
					paneActions={paneActions}
					contextMenuActions={contextMenuActions}
					parentDirection={null}
				/>
			</div>
		);
	}

	return (
		<div className="flex h-full w-full min-h-0 min-w-0 flex-1 overflow-auto bg-[var(--gs-pane-well,transparent)] p-[var(--gs-pane-inset,0px)]">
			<LayoutNodeView
				store={store}
				tab={tab}
				node={tab.layout}
				path={[]}
				registry={registry}
				paneActions={paneActions}
				contextMenuActions={contextMenuActions}
				onSplitResizeDragging={onSplitResizeDragging}
			/>
		</div>
	);
}
