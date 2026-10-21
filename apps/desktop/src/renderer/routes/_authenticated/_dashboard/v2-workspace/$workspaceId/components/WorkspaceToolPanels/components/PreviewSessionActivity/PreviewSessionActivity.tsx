import { useSyncExternalStore } from "react";
import { SessionActivityPill } from "renderer/components/SessionActivityPill/SessionActivityPill";
import { electronTrpcClient } from "renderer/lib/trpc-client";
import { useFocusedSession } from "renderer/stores/focused-session";
import {
	getSessionProgress,
	subscribeSessionProgress,
} from "renderer/stores/session-progress";
import { useStore } from "zustand";
import type { SessionPaneData } from "../../../../types";
import type { ToolPanels } from "../../tool-panel-store";

export function PreviewSessionActivity({
	mainStore,
	tools,
	owner,
	previewTabId,
	previewPaneId,
}: {
	mainStore: ToolPanels["store"];
	tools: ToolPanels;
	owner?: string;
	previewTabId: string;
	previewPaneId: string;
}) {
	useStore(mainStore, (s) => s.tabs);
	useStore(tools.store, (s) => s.tabs);
	const focused = useFocusedSession((s) => s.session);
	const paneId =
		owner?.match(/^(?:codex|claude):(.+)$/)?.[1] ?? focused?.paneId ?? "";
	const progress = useSyncExternalStore(
		(fn) => subscribeSessionProgress(paneId, fn),
		() => getSessionProgress(paneId),
	);
	const inMain = mainStore.getState().getPane(paneId);
	const targetStore = inMain ? mainStore : tools.store;
	const found = inMain ?? tools.store.getState().getPane(paneId);
	if (!progress || !found || found.pane.kind !== "session") return null;
	const provider = (found.pane.data as SessionPaneData).provider ?? "claude";
	const tab = targetStore.getState().getTab(found.tabId);
	const title =
		found.pane.titleOverride ||
		tab?.titleOverride ||
		(provider === "codex" ? "Codex session" : "Claude session");
	return (
		<SessionActivityPill
			key={paneId}
			title={title}
			progress={progress}
			onReturn={() => {
				const current = tools.store.getState().getTab(previewTabId);
				if (current?.maximizedPaneId === previewPaneId)
					tools.store
						.getState()
						.toggleMaximizePane({ tabId: previewTabId, paneId: previewPaneId });
				targetStore.getState().setActiveTab(found.tabId);
				targetStore.getState().setActivePane({ tabId: found.tabId, paneId });
				if (inMain) tools.focus("main");
				else tools.select(found.tabId);
			}}
			onStop={() =>
				provider === "codex"
					? electronTrpcClient.codexSession.interrupt.mutate({ key: paneId })
					: electronTrpcClient.claudeSession.interrupt.mutate({ key: paneId })
			}
		/>
	);
}
