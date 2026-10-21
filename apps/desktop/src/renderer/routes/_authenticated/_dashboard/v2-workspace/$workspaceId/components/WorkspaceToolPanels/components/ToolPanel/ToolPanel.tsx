import { useDroppable } from "@dnd-kit/core";
import {
	horizontalListSortingStrategy,
	SortableContext,
} from "@dnd-kit/sortable";
import type { PaneRegistry, Tab } from "@superset/panes";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@superset/ui/dropdown-menu";
import { toast } from "@superset/ui/sonner";
import {
	ChevronLeft,
	ChevronRight,
	Folder,
	GitCompareArrows,
	Globe,
	Maximize2,
	MessageSquare,
	Minimize2,
	MoreHorizontal,
	PanelBottom,
	PanelRight,
	Plus,
	SquareTerminal,
	X,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import type { PaneViewerData } from "../../../../types";
import type {
	ToolKind,
	ToolPanels,
	ToolPlacement,
} from "../../tool-panel-store";
import { ToolTab } from "../ToolTab/ToolTab";
import { useAnimatedTabs } from "./useAnimatedTabs";

const choices = [
	{ kind: "files", label: "Files", icon: Folder },
	{ kind: "session", label: "Side session", icon: MessageSquare },
	{ kind: "browser", label: "Browser", icon: Globe },
	{ kind: "terminal", label: "Terminal", icon: SquareTerminal },
	{ kind: "changes", label: "Changes", icon: GitCompareArrows },
] as const;

export function ToolPanel({
	side,
	tools,
	tabs,
	registry,
	activeTabId,
	children,
	open,
}: {
	side: ToolPlacement;
	tools: ToolPanels;
	tabs: Tab<PaneViewerData>[];
	registry: PaneRegistry<PaneViewerData>;
	activeTabId: string | null;
	children: ReactNode;
	open: boolean;
}) {
	const { setNodeRef, isOver } = useDroppable({ id: `dock-${side}` });
	const displayedTabs = useAnimatedTabs(tabs);
	const strip = useRef<HTMLDivElement>(null);
	const [edges, setEdges] = useState({ left: false, right: false });
	useEffect(() => {
		const node = strip.current;
		if (!node) return;
		if (!displayedTabs.length) {
			setEdges({ left: false, right: false });
			return;
		}
		const update = () => {
			const next = {
				left: node.scrollLeft > 2,
				right: node.scrollLeft + node.clientWidth < node.scrollWidth - 2,
			};
			setEdges((old) =>
				old.left === next.left && old.right === next.right ? old : next,
			);
		};
		const observer = new ResizeObserver(update);
		observer.observe(node);
		for (const child of node.children) observer.observe(child);
		node.addEventListener("scroll", update, { passive: true });
		update();
		return () => {
			observer.disconnect();
			node.removeEventListener("scroll", update);
		};
	}, [displayedTabs]);
	useEffect(() => {
		const node = strip.current;
		if (!node || !activeTabId) return;
		if (!displayedTabs.some((tab) => tab.id === activeTabId)) return;
		const active = node.querySelector<HTMLElement>(
			`#${CSS.escape(`tool-tab-${activeTabId}`)}`,
		)?.parentElement;
		if (!active) return;
		const reveal = () => {
			const delta =
				active.getBoundingClientRect().left - node.getBoundingClientRect().left;
			if (delta < 0) node.scrollLeft += delta;
			else if (delta + active.offsetWidth > node.clientWidth)
				node.scrollLeft += delta + active.offsetWidth - node.clientWidth;
		};
		const observer = new ResizeObserver(reveal);
		observer.observe(node);
		observer.observe(active);
		reveal();
		return () => observer.disconnect();
	}, [activeTabId, displayedTabs]);
	const scrollTabs = (direction: number) => {
		const node = strip.current;
		if (!node) return;
		const tabs = [...node.querySelectorAll<HTMLElement>(".gs-tool-tab")];
		const origin = tabs[0]?.offsetLeft ?? 0;
		const target =
			node.scrollLeft + direction * Math.max(100, node.clientWidth * 0.7);
		// Land on a whole title instead of leaving clipped tabs at both edges.
		const left = tabs.reduce((closest, tab) => {
			const offset = tab.offsetLeft - origin;
			return Math.abs(offset - target) < Math.abs(closest - target)
				? offset
				: closest;
		}, 0);
		node.scrollTo({
			left,
			behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
				? "instant"
				: "smooth",
		});
	};
	const active = tabs.find((tab) => tab.id === activeTabId);
	const maximized = !!active?.maximizedPaneId;
	async function close(tab: Tab<PaneViewerData>) {
		for (const pane of Object.values(tab.panes)) {
			const guard = registry[pane.kind]?.onBeforeClose;
			if (guard && !(await guard(pane))) return;
		}
		tools.store.getState().removeTab(tab.id);
	}
	function add(kind: ToolKind) {
		void tools
			.open(side, kind)
			.catch((error) =>
				toast.error(
					error instanceof Error ? error.message : "Could not open tool",
				),
			);
	}
	return (
		<section
			ref={setNodeRef}
			aria-label={`${side === "right" ? "Right" : "Bottom"} tools`}
			aria-hidden={!open}
			inert={!open}
			className={`gs-tool-panel ${isOver ? "gs-tool-panel-drop" : ""}`}
			onPointerDownCapture={() => tools.focus(side)}
			onFocusCapture={() => tools.focus(side)}
		>
			<div className="gs-tool-panel-bar flex h-12 min-w-0 shrink-0 items-center gap-1 border-b border-border/60 px-1.5">
				<div
					ref={strip}
					role="tablist"
					aria-label={`${side} tool tabs`}
					className="gs-tool-tab-list flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
				>
					<SortableContext
						items={tabs.map((t) => t.id)}
						strategy={horizontalListSortingStrategy}
					>
						{displayedTabs.map((tab) => (
							<ToolTab
								key={tab.id}
								tab={tab}
								tabs={tabs}
								registry={registry}
								selected={activeTabId === tab.id}
								exiting={!tabs.some((current) => current.id === tab.id)}
								onSelect={() => tools.select(tab.id)}
								onClose={() => void close(tab)}
							/>
						))}
					</SortableContext>
				</div>
				{(edges.left || edges.right) && (
					<div className="gs-tool-scroll-controls">
						<button
							type="button"
							className="gs-tool-icon"
							aria-label="Previous tool tabs"
							disabled={!edges.left}
							onClick={() => scrollTabs(-1)}
						>
							<ChevronLeft size={14} />
						</button>
						<button
							type="button"
							className="gs-tool-icon"
							aria-label="Next tool tabs"
							disabled={!edges.right}
							onClick={() => scrollTabs(1)}
						>
							<ChevronRight size={14} />
						</button>
					</div>
				)}
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<button
							type="button"
							className="gs-tool-icon"
							aria-label={`Add ${side} tool`}
							title="Add tool"
						>
							<Plus className="size-4" />
						</button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end">
						{choices.map(({ kind, label, icon: Icon }) => (
							<DropdownMenuItem key={kind} onSelect={() => add(kind)}>
								<Icon className="size-4" />
								{label}
							</DropdownMenuItem>
						))}
					</DropdownMenuContent>
				</DropdownMenu>
				<button
					type="button"
					className="gs-tool-icon"
					disabled={!active}
					title={`${maximized ? "Restore" : "Expand"} ${side} panel`}
					aria-label={`${maximized ? "Restore" : "Expand"} ${side} panel`}
					onClick={() => {
						if (!active) return;
						const paneId =
							active.maximizedPaneId ??
							active.activePaneId ??
							Object.keys(active.panes)[0];
						if (paneId)
							tools.store
								.getState()
								.toggleMaximizePane({ tabId: active.id, paneId });
					}}
				>
					{maximized ? (
						<Minimize2 className="size-4" />
					) : (
						<Maximize2 className="size-4" />
					)}
				</button>
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<button
							type="button"
							className="gs-tool-icon"
							aria-label={`${side} panel options`}
							title="Panel options"
						>
							<MoreHorizontal size={16} />
						</button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end">
						<DropdownMenuItem
							aria-label={`Move tab to ${side === "right" ? "bottom" : "right"} panel`}
							disabled={!activeTabId}
							onSelect={() =>
								activeTabId &&
								tools.move(activeTabId, side === "right" ? "bottom" : "right")
							}
						>
							{side === "right" ? (
								<PanelBottom size={16} />
							) : (
								<PanelRight size={16} />
							)}
							Move tab to {side === "right" ? "bottom" : "right"} panel
						</DropdownMenuItem>
						<DropdownMenuItem
							aria-label={`Hide ${side} panel`}
							onSelect={() => tools.setOpen(side, false)}
						>
							<X size={16} />
							Hide {side} panel
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</div>
			<div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
				{active ? (
					children
				) : (
					<div className="gs-tool-chooser">
						<fieldset
							aria-label={`Choose a ${side} tool`}
							className="gs-tool-choices"
						>
							{choices.map(({ kind, label, icon: Icon }) => (
								<button
									key={kind}
									type="button"
									className="gs-tool-choice"
									onClick={() => add(kind)}
								>
									<Icon className="size-5 shrink-0 text-muted-foreground" />
									{label}
								</button>
							))}
						</fieldset>
					</div>
				)}
			</div>
		</section>
	);
}
