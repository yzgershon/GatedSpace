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
	Folder,
	GitCompareArrows,
	Globe,
	MessageSquare,
	PanelBottom,
	PanelRight,
	Plus,
	SquareTerminal,
	X,
} from "lucide-react";
import type { ReactNode } from "react";
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
			<div className="gs-tool-panel-bar flex h-14 min-w-0 shrink-0 items-center gap-1 border-b border-border/60 px-2">
				<div
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
					disabled={!activeTabId}
					title={`Move tab to ${side === "right" ? "bottom" : "right"} panel`}
					aria-label={`Move tab to ${side === "right" ? "bottom" : "right"} panel`}
					onClick={() =>
						activeTabId &&
						tools.move(activeTabId, side === "right" ? "bottom" : "right")
					}
				>
					{side === "right" ? (
						<PanelBottom className="size-4" />
					) : (
						<PanelRight className="size-4" />
					)}
				</button>
				<button
					type="button"
					className="gs-tool-icon"
					title={`Hide ${side} panel`}
					aria-label={`Hide ${side} panel`}
					onClick={() => tools.setOpen(side, false)}
				>
					<X className="size-4" />
				</button>
			</div>
			<div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
				{children ?? (
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
