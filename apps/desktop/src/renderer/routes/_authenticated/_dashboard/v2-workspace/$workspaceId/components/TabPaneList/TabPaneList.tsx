import type { Pane, PaneRegistry, Tab, WorkspaceStore } from "@superset/panes";
import { usePaneTitle } from "@superset/panes";
import { cn } from "@superset/ui/utils";
import { StatusIndicator } from "renderer/components/StatusIndicator";
import { useV2SourcesNotificationStatus } from "renderer/hooks/host-service/useV2NotificationStatus";
import { useWorkspace } from "renderer/routes/_authenticated/_dashboard/v2-workspace/providers/WorkspaceProvider";
import { getV2NotificationSourcesForPane } from "renderer/stores/v2-notifications";
import type { StoreApi } from "zustand/vanilla";
import type { PaneViewerData } from "../../types";
import { paneIdsInLayoutOrder } from "./paneIdsInLayoutOrder";

/**
 * The panes inside one tab, listed on hover.
 *
 * This exists because a tab is a fixed 160px (`TAB_WIDTH`), which leaves about
 * 96px for the title — thirteen characters. Joining two pane names with a slash
 * therefore shows the first name and fades out the second, which is the one the
 * join was for. The list sidesteps the width instead of fighting it, and it can
 * carry something the tab's single dot cannot: WHICH pane is the one that
 * finished.
 */
function TabPaneRow({
	pane,
	registry,
	isActive,
	index,
	onSelect,
}: {
	pane: Pane<PaneViewerData>;
	registry: PaneRegistry<PaneViewerData>;
	isActive: boolean;
	index: number;
	onSelect: () => void;
}) {
	const { workspace } = useWorkspace();
	const title = usePaneTitle(pane, registry);
	const status = useV2SourcesNotificationStatus(
		workspace.id,
		getV2NotificationSourcesForPane(pane),
	);

	return (
		<button
			className={cn(
				"flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs transition-colors",
				isActive
					? "bg-highlight/10 text-foreground"
					: "text-muted-foreground hover:bg-muted hover:text-foreground",
			)}
			onClick={onSelect}
			type="button"
		>
			{status ? (
				<StatusIndicator status={status} />
			) : (
				// A placeholder rather than nothing, so the titles stay on one
				// left edge whether or not a pane has anything to report.
				<span className="size-2 shrink-0 rounded-full bg-muted-foreground/30" />
			)}
			{/*
			 * The per-kind icon lives here rather than on the tab. A tab is a fixed
			 * 160px and the mark was competing with the count, the title and the
			 * status dot; a row has room, and this is also the one place where
			 * several panes are shown together, so telling a terminal from a
			 * session at a glance is worth the most.
			 */}
			<span className="flex size-3.5 shrink-0 items-center justify-center">
				{registry[pane.kind]?.getTabIcon?.(pane)}
			</span>
			<span className="min-w-0 flex-1 truncate">{title}</span>
			<span className="shrink-0 rounded-[3px] border border-border px-1 font-mono text-[10px] text-muted-foreground/60 leading-[15px]">
				{index + 1}
			</span>
		</button>
	);
}

export function TabPaneList({
	tab,
	registry,
	store,
}: {
	tab: Tab<PaneViewerData>;
	registry: PaneRegistry<PaneViewerData>;
	store: StoreApi<WorkspaceStore<PaneViewerData>>;
}) {
	const panes = paneIdsInLayoutOrder(tab).flatMap((paneId) => {
		const pane = tab.panes[paneId];
		return pane ? [pane] : [];
	});

	return (
		<div>
			<div className="px-2 pt-1 pb-1 text-[10px] text-muted-foreground/65 uppercase tracking-wider">
				{tab.titleOverride
					? `${tab.titleOverride} · ${panes.length} panes`
					: `${panes.length} panes in this tab`}
			</div>
			{panes.map((pane, index) => (
				<TabPaneRow
					index={index}
					isActive={pane.id === tab.activePaneId}
					key={pane.id}
					onSelect={() => {
						// Both, and in this order. The hover card is PORTALED out of the
						// tab, so a click in here never reaches the tab's own onClick —
						// without `setActiveTab` you would focus a pane inside a tab you
						// are not looking at, and nothing on screen would change.
						store.getState().setActiveTab(tab.id);
						store.getState().setActivePane({ tabId: tab.id, paneId: pane.id });
					}}
					pane={pane}
					registry={registry}
				/>
			))}
		</div>
	);
}
