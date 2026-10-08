import {
	type BrowserPanelRequest,
	type BrowserPanelResult,
	browserUrlKey,
} from "shared/agent-browser";
import type { BrowserPaneData } from "../../types";
import type { createToolPanels } from "./tool-panel-store";

export function openAgentBrowserTab(
	tools: ReturnType<typeof createToolPanels>,
	request: BrowserPanelRequest,
): BrowserPanelResult {
	const known = new Set(request.knownPaneIds);
	const owned = () =>
		tools.store.getState().tabs.flatMap((tab) =>
			Object.values(tab.panes).flatMap((pane) => {
				if (pane.kind !== "browser") return [];
				const data = pane.data as BrowserPaneData;
				if (
					data.agentSessionKey !== request.sessionKey &&
					(data.agentSessionKey || !known.has(pane.id))
				)
					return [];
				return [{ tab, pane, data }];
			}),
		);
	const list = () =>
		owned().map(({ tab, pane, data }) => {
			const side = tools.state.getState().placement[tab.id] ?? "right";
			const panel = tools.state.getState()[side];
			return {
				tabId: pane.id,
				url: data.url,
				title: pane.titleOverride ?? data.pageTitle ?? data.url,
				active:
					panel.open &&
					panel.activeTabId === tab.id &&
					(!tab.maximizedPaneId || tab.maximizedPaneId === pane.id) &&
					tab.activePaneId === pane.id,
			};
		});
	if (request.action === "list") return { tabs: list() };
	const url = browserUrlKey(request.url ?? "");
	if (request.action === "open" && !url)
		throw new Error("Supply an HTTP, HTTPS, or saved preview URL.");
	// Search only this agent's tabs. A matching page in another session must
	// never silently grant that session's browser access to the caller.
	const existing = request.paneId
		? owned().find(({ pane }) => pane.id === request.paneId)
		: owned().find(({ data }) => browserUrlKey(data.url) === url);
	if (existing) {
		const { tab, pane, data } = existing;
		if (!data.agentSessionKey)
			tools.store.getState().setPaneData({
				paneId: pane.id,
				data: { ...data, agentSessionKey: request.sessionKey },
			});
		if (tab.maximizedPaneId && tab.maximizedPaneId !== pane.id)
			tools.store.getState().toggleMaximizePane({
				tabId: tab.id,
				paneId: tab.maximizedPaneId,
			});
		tools.store.getState().setActivePane({ tabId: tab.id, paneId: pane.id });
		tools.select(tab.id);
		return {
			paneId: pane.id,
			reused: request.action === "select" || browserUrlKey(data.url) === url,
			tabs: list(),
		};
	}
	if (request.action === "select")
		throw new Error(
			"Browser tab is closed. Use browser_tabs to find an open tab.",
		);
	if (request.paneId && tools.store.getState().getPane(request.paneId))
		throw new Error("This browser tab belongs to another session.");
	const paneId = request.paneId ?? `agent-browser-${crypto.randomUUID()}`;
	// Let the page reflow at the user's panel width. Device emulation is opt-in.
	tools.add("right", {
		id: paneId,
		kind: "browser",
		data: {
			url: url as string,
			previewMode: "responsive",
			agentSessionKey: request.sessionKey,
		},
	});
	return { paneId, reused: false, tabs: list() };
}
