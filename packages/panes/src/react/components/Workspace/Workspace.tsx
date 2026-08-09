import { cn } from "@superset/ui/utils";
import { useEffect, useRef } from "react";
import { useStore } from "zustand";
import type { Pane } from "../../../types";
import type { WorkspaceProps } from "../../types";
import { Tab } from "./components/Tab";
import { TabBar } from "./components/TabBar";
import { useWorkspaceInteractionState } from "./hooks/useWorkspaceInteractionState";

export function Workspace<TData>({
	store,
	registry,
	className,
	renderTabAccessory,
	renderTabIcon,
	renderEmptyState,
	renderAddTabMenu,
	renderTabBarTrailing,
	renderBelowTabBar,
	onBeforeCloseTab,
	onAfterCloseTab,
	onInteractionStateChange,
	paneActions,
	contextMenuActions,
}: WorkspaceProps<TData>) {
	const tabs = useStore(store, (s) => s.tabs);
	const activeTabId = useStore(store, (s) => s.activeTabId);
	const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;
	const { onSplitResizeDragging } = useWorkspaceInteractionState({
		onInteractionStateChange,
	});

	/**
	 * "This pane closed" is INFERRED here, by diffing pane ids frame to frame.
	 * Nothing calls it; a pane that stopped existing is assumed to have been
	 * closed.
	 *
	 * That inference cannot tell a close from a move, and `onAfterClose` is
	 * destructive — for a session pane it kills the process and drops the unsent
	 * prompt. Any moment where an id is transiently missing from the store, for
	 * any reason, silently destroys work the user typed and has no other copy of.
	 *
	 * So the verdict is deferred and then RE-CHECKED against the live store,
	 * not against the snapshot this effect closed over. A pane that is absent
	 * for a tick and back afterwards was moved, not closed, and is left alone.
	 * A genuinely closed pane is still absent when the check runs and disposes
	 * exactly as before, one tick later — nothing observable depends on that
	 * timing.
	 *
	 * Cheaper than it looks: the timeout only fires when an id actually went
	 * missing, which is rare, and it is cleared if the effect re-runs first.
	 */
	const previousPanesRef = useRef<Map<string, Pane<TData>>>(new Map());
	useEffect(() => {
		const current = new Map<string, Pane<TData>>();
		for (const tab of tabs) {
			for (const pane of Object.values(tab.panes)) {
				current.set(pane.id, pane);
			}
		}
		const vanished: Pane<TData>[] = [];
		for (const [prevId, prevPane] of previousPanesRef.current) {
			if (!current.has(prevId)) vanished.push(prevPane);
		}
		previousPanesRef.current = current;
		if (vanished.length === 0) return;

		const timer = setTimeout(() => {
			const live = new Set<string>();
			for (const tab of store.getState().tabs) {
				for (const id of Object.keys(tab.panes)) live.add(id);
			}
			for (const pane of vanished) {
				if (live.has(pane.id)) continue;
				registry[pane.kind]?.onAfterClose?.(pane);
			}
		}, 0);
		return () => clearTimeout(timer);
	}, [tabs, registry, store]);

	const closeTab = async (tabId: string) => {
		const tab = store.getState().getTab(tabId);
		if (!tab) return;
		if (onBeforeCloseTab) {
			const allowed = await onBeforeCloseTab(tab);
			if (!allowed) return;
		}
		// Re-check after the await: the tab may have been removed concurrently.
		if (!store.getState().getTab(tabId)) return;
		store.getState().removeTab(tabId);
		try {
			onAfterCloseTab?.(tab);
		} catch (err) {
			console.error("onAfterCloseTab threw", err);
		}
	};

	return (
		<div
			className={cn(
				"flex h-full w-full min-h-0 min-w-0 flex-col overflow-hidden bg-background text-foreground",
				className,
			)}
		>
			<TabBar
				tabs={tabs}
				registry={registry}
				activeTabId={activeTabId}
				onSelectTab={(tabId) => store.getState().setActiveTab(tabId)}
				onCloseTab={closeTab}
				onCloseOtherTabs={async (tabId) => {
					for (const tab of tabs) {
						if (tab.id !== tabId) await closeTab(tab.id);
					}
				}}
				onCloseAllTabs={async () => {
					for (const tab of tabs) {
						await closeTab(tab.id);
					}
				}}
				onRenameTab={(tabId, title) =>
					store.getState().setTabTitleOverride({ tabId, titleOverride: title })
				}
				onReorderTab={(tabId, toIndex) =>
					store.getState().reorderTab({ tabId, toIndex })
				}
				onMovePaneToNewTab={(paneId, toIndex) =>
					store.getState().movePaneToNewTab({ paneId, toIndex })
				}
				renderTabIcon={renderTabIcon}
				renderAddTabMenu={renderAddTabMenu}
				renderTabBarTrailing={renderTabBarTrailing}
				renderTabAccessory={renderTabAccessory}
			/>
			{renderBelowTabBar?.()}
			{activeTab ? (
				<Tab
					store={store}
					tab={activeTab}
					registry={registry}
					paneActions={paneActions}
					contextMenuActions={contextMenuActions}
					onSplitResizeDragging={onSplitResizeDragging}
				/>
			) : (
				<div className="flex min-h-0 min-w-0 flex-1 items-center justify-center text-sm text-muted-foreground">
					{renderEmptyState?.() ?? "No tabs open"}
				</div>
			)}
		</div>
	);
}
