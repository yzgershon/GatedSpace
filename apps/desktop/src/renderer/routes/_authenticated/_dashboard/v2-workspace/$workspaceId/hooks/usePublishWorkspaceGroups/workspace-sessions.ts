import type { Tab } from "@superset/panes";
import type { WorkspaceSession } from "renderer/stores/workspace-groups";
import type { PaneViewerData, SessionPaneData } from "../../types";

/** Both providers use kind="session". Read the saved provider, never the label. */
export function workspaceSessions(
	tab: Tab<PaneViewerData>,
	paneIds: readonly string[],
): WorkspaceSession[] {
	return paneIds.flatMap((paneId) => {
		const pane = tab.panes[paneId];
		if (pane?.kind !== "session") return [];
		return [
			{
				paneId,
				provider: (pane.data as SessionPaneData).provider ?? "claude",
				title:
					pane.titleOverride?.trim() ||
					(Object.keys(tab.panes).length === 1
						? tab.titleOverride?.trim()
						: undefined),
			},
		];
	});
}
