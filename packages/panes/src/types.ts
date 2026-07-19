export type SplitDirection = "horizontal" | "vertical";

export type SplitPosition = "top" | "right" | "bottom" | "left";

export type SplitBranch = "first" | "second";

export type SplitPath = SplitBranch[];

export type LayoutNode =
	| { type: "pane"; paneId: string }
	| {
			type: "split";
			direction: SplitDirection;
			first: LayoutNode;
			second: LayoutNode;
			splitPercentage?: number;
	  };

export interface Pane<TData> {
	id: string;
	kind: string;
	titleOverride?: string;
	pinned?: boolean;
	data: TData;
}

export interface Tab<TData> {
	id: string;
	titleOverride?: string;
	createdAt: number;
	activePaneId: string | null;
	// When set (and the pane still exists), the tab renders only this pane
	// fullscreen, hiding the split layout. Toggled via the pane header's
	// expand button. Persisted with the layout so it survives reloads.
	maximizedPaneId?: string | null;
	layout: LayoutNode;
	panes: Record<string, Pane<TData>>;
}

export interface WorkspaceState<TData> {
	version: 1;
	tabs: Tab<TData>[];
	activeTabId: string | null;
}
