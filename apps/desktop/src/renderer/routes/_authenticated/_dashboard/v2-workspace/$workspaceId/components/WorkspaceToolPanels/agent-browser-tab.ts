import type { createToolPanels } from "./tool-panel-store";

export function openAgentBrowserTab(
	tools: ReturnType<typeof createToolPanels>,
	request: { paneId: string; url: string },
) {
	const tab = tools.store
		.getState()
		.tabs.find((tab) => tab.panes[request.paneId]);
	if (tab) tools.select(tab.id);
	else
		tools.add("right", {
			id: request.paneId,
			kind: "browser",
			data: { url: request.url },
		});
}
