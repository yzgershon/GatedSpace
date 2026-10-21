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
		setActivatorNodeRef,
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
			data-selected={selected}
			onAuxClick={(event) => {
				if (event.button === 1) {
					event.preventDefault();
					onClose();
				}
			}}
			inert={exiting}
			aria-hidden={exiting}
			ref={setNodeRef}
			style={{ transform: CSS.Transform.toString(transform), transition }}
			className={cn(
				"gs-tool-tab group relative flex h-8 shrink-0 items-center rounded-lg text-muted-foreground",
				selected && "bg-muted text-foreground",
				isDragging && "z-50 opacity-60",
				exiting && "gs-tool-tab-exiting",
			)}
		>
			<button
				ref={setActivatorNodeRef}
				{...attributes}
				{...listeners}
				type="button"
				role="tab"
				aria-label={title}
				id={`tool-tab-${exiting ? "exiting-" : ""}${tab.id}`}
				aria-controls={selected && !exiting ? `tool-view-${tab.id}` : undefined}
				aria-selected={selected}
				className="gs-tool-tab-select flex h-full min-w-0 flex-1 items-center justify-start gap-1.5 rounded-lg text-[11px] outline-none focus-visible:ring-1 focus-visible:ring-ring touch-none"
				onClick={onSelect}
				title={`${title} · Drag to reorder; Space then arrow keys to move`}
			>
				<span className="flex size-3.5 shrink-0 items-center justify-center [&>svg]:size-3.5">
					{pane && registry[pane.kind]?.getTabIcon?.(pane)}
				</span>
				<span className="gs-tool-tab-title truncate">{title}</span>
			</button>
			<button
				type="button"
				aria-label={`Close ${title}`}
				title={`Close ${title}`}
				onClick={onClose}
				className="gs-tool-tab-close mr-0.5 flex size-6 shrink-0 items-center justify-center rounded opacity-0 transition-opacity group-hover:opacity-60 hover:bg-background hover:opacity-100 focus-visible:opacity-100"
			>
				<X className="size-3" />
			</button>
		</div>
	);
}
