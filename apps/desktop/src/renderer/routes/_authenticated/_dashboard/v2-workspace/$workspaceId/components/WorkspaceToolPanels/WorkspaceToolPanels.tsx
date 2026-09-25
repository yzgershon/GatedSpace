import {
	closestCenter,
	DndContext,
	KeyboardSensor,
	PointerSensor,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import {
	type ContextMenuActionConfig,
	type PaneActionConfig,
	type PaneRegistry,
	Workspace,
} from "@superset/panes";
import {
	type CSSProperties,
	type ReactNode,
	useEffect,
	useRef,
	useState,
} from "react";
import { useStore } from "zustand";
import type { PaneViewerData } from "../../types";
import { ToolPanel } from "./components/ToolPanel/ToolPanel";
import {
	panelDefaults,
	type ToolPanels,
	type ToolPlacement,
} from "./tool-panel-store";
import "./tool-panels.css";

export function WorkspaceToolPanels({
	tools,
	registry,
	paneActions,
	contextMenuActions,
	onResizing,
	mainMinimum = { width: 400, height: 260 },
	children,
}: {
	tools: ToolPanels;
	registry: PaneRegistry<PaneViewerData>;
	children: ReactNode;
	paneActions: PaneActionConfig<PaneViewerData>[];
	contextMenuActions: ContextMenuActionConfig<PaneViewerData>[];
	onResizing: (resizing: boolean) => void;
	mainMinimum?: { width: number; height: number };
}) {
	const panels = useStore(tools.state);
	const tabs = useStore(tools.store, (s) => s.tabs);
	// The pane's own maximize action must also expand its enclosing tool panel.
	// Keep the other surfaces mounted, and leave the saved dock sizes untouched.
	const expanded = ([panels.focus, "right", "bottom"] as const).find(
		(side) =>
			side !== "main" &&
			panels[side].open &&
			tabs.some(
				(tab) =>
					tab.id === panels[side].activeTabId &&
					tab.maximizedPaneId &&
					tab.panes[tab.maximizedPaneId],
			),
	);
	const [bounds, setBounds] = useState({ width: 1200, height: 800 });
	const [resizing, setResizing] = useState(false);
	const [present, setPresent] = useState({
		right: panels.right.open,
		bottom: panels.bottom.open,
	});
	useEffect(() => {
		setPresent((previous) => ({
			right: previous.right || panels.right.open,
			bottom: previous.bottom || panels.bottom.open,
		}));
		const timer = setTimeout(
			() =>
				setPresent({ right: panels.right.open, bottom: panels.bottom.open }),
			260,
		);
		return () => clearTimeout(timer);
	}, [panels.right.open, panels.bottom.open]);
	const root = useRef<HTMLDivElement>(null);
	const resizeStart = useRef<{
		side: ToolPlacement;
		coordinate: number;
		size: number;
		scale: number;
	} | null>(null);
	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
		useSensor(KeyboardSensor, {
			coordinateGetter: sortableKeyboardCoordinates,
		}),
	);
	useEffect(() => {
		const el = root.current;
		if (!el) return;
		const observer = new ResizeObserver(() =>
			setBounds({ width: el.clientWidth, height: el.clientHeight }),
		);
		observer.observe(el);
		return () => observer.disconnect();
	}, []);
	useEffect(() => () => onResizing(false), [onResizing]);
	const rightMax = Math.max(240, bounds.width - mainMinimum.width);
	const bottomMax = Math.max(180, bounds.height - mainMinimum.height);
	const rightSize = Math.min(panels.right.size, rightMax, bounds.width * 0.6);
	const bottomSize = Math.min(
		panels.bottom.size,
		bottomMax,
		bounds.height * 0.65,
	);
	function finishResize() {
		resizeStart.current = null;
		setResizing(false);
		onResizing(false);
	}
	const renderHandle = (side: ToolPlacement) => (
		// biome-ignore lint/a11y/useSemanticElements: an interactive splitter needs separator range semantics, not a static horizontal rule
		<div
			key={side}
			role="separator"
			tabIndex={panels[side].open && !expanded ? 0 : -1}
			aria-label={`Resize ${side} panel`}
			aria-orientation={side === "right" ? "vertical" : "horizontal"}
			aria-valuenow={Math.round(side === "right" ? rightSize : bottomSize)}
			aria-valuemin={180}
			aria-valuemax={Math.round(side === "right" ? rightMax : bottomMax)}
			className={`gs-tool-resize gs-tool-resize-${side}`}
			style={{
				visibility: panels[side].open && !expanded ? "visible" : "hidden",
			}}
			onDoubleClick={() => tools.resize(side, panelDefaults[side])}
			onKeyDown={(event) => {
				const step =
					event.key === "ArrowLeft" || event.key === "ArrowUp"
						? 20
						: event.key === "ArrowRight" || event.key === "ArrowDown"
							? -20
							: 0;
				if (step) {
					event.preventDefault();
					tools.resize(
						side,
						Math.min(
							side === "right" ? rightMax : bottomMax,
							panels[side].size + step,
						),
					);
				}
				if (event.key === "Home") tools.resize(side, panelDefaults[side]);
			}}
			onPointerDown={(event) => {
				if (event.button !== 0 || !root.current) return;
				event.preventDefault();
				event.currentTarget.setPointerCapture(event.pointerId);
				resizeStart.current = {
					side,
					coordinate: side === "right" ? event.clientX : event.clientY,
					size: side === "right" ? rightSize : bottomSize,
					scale:
						root.current.getBoundingClientRect().width /
						root.current.clientWidth,
				};
				setResizing(true);
				onResizing(true);
			}}
			onPointerMove={(event) => {
				const start = resizeStart.current;
				if (!start) return;
				const delta =
					(start.coordinate -
						(start.side === "right" ? event.clientX : event.clientY)) /
					start.scale;
				tools.resize(
					start.side,
					Math.min(
						start.side === "right" ? rightMax : bottomMax,
						start.size + delta,
					),
				);
			}}
			onPointerUp={finishResize}
			onPointerCancel={finishResize}
			onLostPointerCapture={finishResize}
		/>
	);
	return (
		<DndContext
			sensors={sensors}
			collisionDetection={closestCenter}
			onDragStart={() => onResizing(true)}
			onDragCancel={() => onResizing(false)}
			onDragEnd={({ active, over }) => {
				onResizing(false);
				if (!over || active.id === over.id) return;
				const target = String(over.id);
				const side =
					target === "dock-bottom"
						? "bottom"
						: target === "dock-right"
							? "right"
							: panels.placement[target];
				if (side)
					tools.move(
						String(active.id),
						side,
						target.startsWith("dock-") ? undefined : target,
					);
			}}
		>
			<Workspace
				store={tools.store}
				registry={registry}
				showTabBar={false}
				paneActions={paneActions}
				contextMenuActions={contextMenuActions}
				renderContent={(renderTab) => (
					<div
						ref={root}
						data-expanded={expanded}
						className={`gs-tool-workspace ${resizing ? "gs-tool-workspace-resizing" : ""}`}
						style={
							{
								"--tool-right": `${panels.right.open ? rightSize : 0}px`,
								"--tool-bottom": `${panels.bottom.open ? bottomSize : 0}px`,
							} as CSSProperties
						}
					>
						<div
							className="gs-tool-main"
							inert={!!expanded}
							aria-hidden={!!expanded}
							data-browser-clip
							onPointerDownCapture={() => tools.focus("main")}
							onFocusCapture={() => tools.focus("main")}
						>
							{children}
						</div>
						{(["right", "bottom"] as const).map((side) => {
							const sideTabs = tabs.filter(
								(t) => panels.placement[t.id] === side,
							);
							const active =
								sideTabs.find((t) => t.id === panels[side].activeTabId) ??
								sideTabs[0];
							return (
								<div
									key={side}
									className={`gs-tool-slot gs-tool-slot-${side}`}
									data-open={panels[side].open}
									inert={!!expanded && expanded !== side}
									aria-hidden={!!expanded && expanded !== side}
									data-browser-clip
								>
									{renderHandle(side)}
									<ToolPanel
										side={side}
										tools={tools}
										tabs={sideTabs}
										registry={registry}
										activeTabId={active?.id ?? null}
										open={panels[side].open}
									>
										{(panels[side].open || present[side]) && active ? (
											<div
												key={active.id}
												role="tabpanel"
												id={`tool-view-${active.id}`}
												aria-labelledby={`tool-tab-${active.id}`}
												className="gs-tool-view flex min-h-0 flex-1 flex-col"
											>
												{renderTab(
													active,
													panels[side].open && panels.focus === side,
												)}
											</div>
										) : null}
									</ToolPanel>
								</div>
							);
						})}
					</div>
				)}
			/>
		</DndContext>
	);
}
