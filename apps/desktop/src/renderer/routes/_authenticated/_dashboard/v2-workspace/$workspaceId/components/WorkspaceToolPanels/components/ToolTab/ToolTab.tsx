import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { type PaneRegistry, type Tab, useTabTitle } from "@superset/panes";
import { cn } from "@superset/ui/utils";
import { X } from "lucide-react";
import type { PaneViewerData } from "../../../../types";

export function ToolTab({
	tab,
	tabs,
	registry,
	selected,
	exiting = false,
	onSelect,
	onClose,
}: {
	tab: Tab<PaneViewerData>;
	tabs: Tab<PaneViewerData>[];
	registry: PaneRegistry<PaneViewerData>;
	selected: boolean;
	exiting?: boolean;
	onSelect: () => void;
	onClose: () => void;
}) {
	const {
		attributes,
		listeners,
		setNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable({
		id: exiting ? `exiting-${tab.id}` : tab.id,
		disabled: exiting,
	});
	const title = useTabTitle(tab, tabs, registry);
	const pane = tab.activePaneId
		? tab.panes[tab.activePaneId]
		: Object.values(tab.panes)[0];
	return (
		<div
			inert={exiting}
			aria-hidden={exiting}
			ref={setNodeRef}
			style={{ transform: CSS.Transform.toString(transform), transition }}
			className={cn(
				"gs-tool-tab group relative flex h-9 max-w-52 shrink-0 items-center rounded-xl border border-transparent text-muted-foreground",
				selected && "border-border bg-muted text-foreground",
				isDragging && "z-50 opacity-60",
				exiting && "gs-tool-tab-exiting",
			)}
		>
			<button
				{...attributes}
				{...listeners}
				type="button"
				role="tab"
				id={`tool-tab-${exiting ? "exiting-" : ""}${tab.id}`}
				aria-controls={selected && !exiting ? `tool-view-${tab.id}` : undefined}
				aria-selected={selected}
				className="flex h-full min-w-0 items-center gap-2 rounded-l-xl pl-3 pr-1 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring touch-none"
				onClick={onSelect}
				title={`${title} · Drag to reorder; Space then arrow keys to move`}
			>
				<span className="flex size-4 shrink-0 items-center justify-center">
					{pane && registry[pane.kind]?.getTabIcon?.(pane)}
				</span>
				<span className="truncate">{title}</span>
			</button>
			<button
				type="button"
				aria-label={`Close ${title}`}
				title={`Close ${title}`}
				onClick={onClose}
				className="mx-1 flex size-6 shrink-0 items-center justify-center rounded-md opacity-50 transition hover:bg-background hover:opacity-100 focus-visible:opacity-100"
			>
				<X className="size-3.5" />
			</button>
		</div>
	);
}
