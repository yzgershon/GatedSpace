import type { ReactNode } from "react";
import type { StoreApi } from "zustand/vanilla";
import type { CreatePaneInput, WorkspaceStore } from "../core/store";
import type { Pane, Tab } from "../types";

export interface PaneActionConfig<TData> {
	key: string;
	icon: ReactNode | ((context: RendererContext<TData>) => ReactNode);
	tooltip: ReactNode | ((context: RendererContext<TData>) => ReactNode);
	onClick: (context: RendererContext<TData>) => void;
	label?: string;
	pressed?: boolean;
	placement?: "title" | "trailing";
}

export interface ContextMenuActionConfig<TData> {
	key: string;
	label?: string;
	icon?: ReactNode;
	hotkeyId?: string;
	shortcut?: string;
	onSelect?: (context: RendererContext<TData>) => void;
	disabled?: boolean | ((context: RendererContext<TData>) => boolean);
	variant?: "destructive";
	type?: "item" | "separator";
	children?:
		| ContextMenuActionConfig<TData>[]
		| ((context: RendererContext<TData>) => ContextMenuActionConfig<TData>[]);
}

export interface PaneContext<TData> extends Pane<TData> {
	parentDirection: "horizontal" | "vertical" | null;
}

export interface TabContext<TData> extends Tab<TData> {
	position: number;
}

export interface RendererContext<TData> {
	pane: PaneContext<TData>;
	tab: TabContext<TData>;
	isActive: boolean;
	store: StoreApi<WorkspaceStore<TData>>;

	actions: {
		close: () => void;
		focus: () => void;
		setTitle: (title?: string) => void;
		pin: () => void;
		updateData: (data: TData) => void;
		split: (
			position: "right" | "down",
			newPane: CreatePaneInput<TData>,
		) => void;
	};

	components: {
		/** Render slot: invoke it so focus updates preserve the button DOM. */
		PaneHeaderActions: (placement?: "title" | "trailing") => ReactNode;
	};
}

export interface PaneTitleSource {
	subscribe: (callback: () => void) => () => void;
	getSnapshot: () => string | undefined;
}

export interface PaneDefinition<TData> {
	renderPane(context: RendererContext<TData>): ReactNode;
	getTitle?(pane: Pane<TData>): string | undefined;
	/**
	 * Optional reactive title source. When defined, the tab title (and other
	 * title-aware UI) subscribes to it and re-renders when the runtime title
	 * changes — without mirroring runtime state into the pane store.
	 */
	titleSource?(pane: Pane<TData>): PaneTitleSource | undefined;
	getIcon?(context: RendererContext<TData>): ReactNode;
	/**
	 * Icon for the TAB, as opposed to `getIcon`, which draws the pane header.
	 *
	 * Separate because it takes a pane rather than a `RendererContext`: a tab
	 * has no rendered pane behind it, so there are no actions, no store binding
	 * and no `isActive` to hand over. Every `getIcon` in practice reads nothing
	 * but `context.pane`, but faking the rest of a context to reuse it would
	 * break the first definition that reached for `actions` — quietly, and only
	 * in the tab bar. Matches `getTitle`/`titleSource`, which are pane-only for
	 * the same reason.
	 */
	getTabIcon?(pane: Pane<TData>): ReactNode;
	/**
	 * A CSS colour identifying what this pane is running, used to tint its
	 * header. Return undefined for panes with nothing to identify — they fall
	 * back to the neutral header, which is a deliberate look rather than a gap.
	 *
	 * A colour rather than a name on purpose: this package has no idea what an
	 * "agent" is, and giving it one would put a product concept inside a generic
	 * layout library. The app decides what deserves a colour and which.
	 */
	getAccent?(context: RendererContext<TData>): string | undefined;
	renderTitle?(context: RendererContext<TData>): ReactNode;
	renderHeaderLead?(context: RendererContext<TData>): ReactNode;
	renderMenuHeader?(context: RendererContext<TData>): ReactNode;
	hideMaximizeControl?: boolean;
	renderHeaderExtras?(context: RendererContext<TData>): ReactNode;
	/**
	 * Rendered in the LEFT cluster, immediately after the pane's title.
	 *
	 * `renderHeaderExtras` puts things in the right-hand cluster beside the
	 * window controls, which is the wrong end for anything that reads as part
	 * of the title — a folder name over there is separated from the name it
	 * qualifies by the entire width of the pane.
	 */
	renderTitleTrailing?(context: RendererContext<TData>): ReactNode;
	/**
	 * Centred in the pane header, independent of both side clusters.
	 *
	 * Absolutely positioned, the same trick the top bar's presets use, so it
	 * stays centred on the PANE rather than drifting as the title lengthens or
	 * the action cluster changes width. For a value you read at a glance across
	 * four panes, a fixed position matters more than tight packing.
	 */
	renderHeaderCenter?(context: RendererContext<TData>): ReactNode;
	renderToolbar?(context: RendererContext<TData>): ReactNode;
	onHeaderClick?(context: RendererContext<TData>): void;
	onBeforeClose?(pane: Pane<TData>): boolean | Promise<boolean>;
	onAfterClose?(pane: Pane<TData>): void;
	paneActions?:
		| PaneActionConfig<TData>[]
		| ((
				context: RendererContext<TData>,
				defaults: PaneActionConfig<TData>[],
		  ) => PaneActionConfig<TData>[]);
	contextMenuActions?:
		| ContextMenuActionConfig<TData>[]
		| ((
				context: RendererContext<TData>,
				defaults: ContextMenuActionConfig<TData>[],
		  ) => ContextMenuActionConfig<TData>[]);
}

export type PaneRegistry<TData> = Record<string, PaneDefinition<TData>>;

export interface WorkspaceInteractionState {
	resizeActive: boolean;
}

export interface WorkspaceProps<TData> {
	store: StoreApi<WorkspaceStore<TData>>;
	registry: PaneRegistry<TData>;
	className?: string;
	isActive?: boolean;
	/** Optional host layout for several visible tabs, sharing one lifecycle owner. */
	renderContent?: (
		renderTab: (tab: Tab<TData>, isActive: boolean) => ReactNode,
	) => ReactNode;
	renderTabAccessory?: (tab: Tab<TData>) => ReactNode;
	renderTabIcon?: (tab: Tab<TData>) => ReactNode;
	/**
	 * Contents of the hover card listing a multi-pane tab's panes. Only asked
	 * for when a tab holds more than one pane — a single-pane tab has nothing
	 * to expand, so it keeps its plain title tooltip.
	 *
	 * A render prop because the rows carry per-pane agent status, and this
	 * package has no notion of an agent.
	 */
	renderTabPaneList?: (tab: Tab<TData>) => ReactNode;
	renderEmptyState?: () => ReactNode;
	renderAddTabMenu?: () => ReactNode;
	/**
	 * Create a tab directly from `+`, rather than opening a menu first.
	 *
	 * When set it wins over `renderAddTabMenu`: a host that can make an
	 * undecided tab does not need a dropdown, because the tab can be asked what
	 * it should be after it exists — and asked again if the answer changes.
	 */
	onAddTab?: () => void;
	/** Rendered at the trailing (right) edge of the tab bar row. */
	/**
	 * Whether the tab strip renders at all. Defaults to true.
	 *
	 * A host that turns it off is responsible for supplying the two things the
	 * strip is the only home for: a way to switch groups, and a DROP TARGET for
	 * a pane dragged out of its tab. `movePaneToNewTab` on the store is what
	 * that target should call.
	 */
	showTabBar?: boolean;
	renderTabBarTrailing?: () => ReactNode;
	renderBelowTabBar?: () => ReactNode;
	onBeforeClosePane?: (
		pane: Pane<TData>,
		tab: Tab<TData>,
	) => boolean | Promise<boolean>;
	onBeforeCloseTab?: (tab: Tab<TData>) => boolean | Promise<boolean>;
	onAfterCloseTab?: (tab: Tab<TData>) => void;
	onInteractionStateChange?: (state: WorkspaceInteractionState) => void;
	paneActions?:
		| PaneActionConfig<TData>[]
		| ((context: RendererContext<TData>) => PaneActionConfig<TData>[]);
	contextMenuActions?:
		| ContextMenuActionConfig<TData>[]
		| ((context: RendererContext<TData>) => ContextMenuActionConfig<TData>[]);
}
