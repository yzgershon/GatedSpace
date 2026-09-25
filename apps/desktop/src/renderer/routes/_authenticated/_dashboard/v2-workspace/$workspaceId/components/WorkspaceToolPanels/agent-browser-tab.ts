import type { createToolPanels } from "./tool-panel-store";

export function openAgentBrowserTab(
	tools: ReturnType<typeof createToolPanels>,
	request: { paneId: string; url: string },
) {
	const tab = tools.store
		.getState()
		.tabs.find((tab) => tab.panes[request.paneId]);
	if (tab) tools.select(tab.id);
	else {
		// Agent previews should show the whole desktop canvas rather than crop it
		// into the narrow default tool column. The user can switch to Responsive.
		tools.resize("right", Math.max(tools.state.getState().right.size, 720));
		tools.add("right", {
			id: request.paneId,
			kind: "browser",
			data: { url: request.url, previewMode: "desktop" },
		});
	}
}
