import type { RendererContext } from "@superset/panes";
import type { PaneViewerData } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/types";
import { create } from "zustand";

export const useLiveCodeState = create<{
	panes: Record<string, { restoreMaximized: string | null }>;
}>(() => ({ panes: {} }));

export function forgetLiveCode(paneId: string) {
	useLiveCodeState.setState((state) => {
		const panes = { ...state.panes };
		delete panes[paneId];
		return { panes };
	});
}

export function toggleLiveCode(ctx: RendererContext<PaneViewerData>) {
	const saved = useLiveCodeState.getState().panes[ctx.pane.id];
	const tab = ctx.store.getState().getTab(ctx.tab.id);
	if (!tab) return;
	if (saved) {
		forgetLiveCode(ctx.pane.id);
		if (
			tab.maximizedPaneId === ctx.pane.id &&
			saved.restoreMaximized !== ctx.pane.id
		) {
			ctx.store.getState().toggleMaximizePane({
				tabId: tab.id,
				paneId:
					saved.restoreMaximized && tab.panes[saved.restoreMaximized]
						? saved.restoreMaximized
						: ctx.pane.id,
			});
		}
	} else {
		useLiveCodeState.setState((state) => ({
			panes: {
				...state.panes,
				[ctx.pane.id]: { restoreMaximized: tab.maximizedPaneId ?? null },
			},
		}));
		ctx.actions.focus();
		if (tab.maximizedPaneId !== ctx.pane.id)
			ctx.store
				.getState()
				.toggleMaximizePane({ tabId: tab.id, paneId: ctx.pane.id });
	}
}
