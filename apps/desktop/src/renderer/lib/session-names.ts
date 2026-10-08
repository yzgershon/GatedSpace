import type { Pane, PaneRegistry, Tab } from "@superset/panes";
import { toast } from "@superset/ui/sonner";
import type { PaneViewerData } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/types";
import { paneNameRef } from "./session-name-layout";

export { applySessionNames, paneNameRef } from "./session-name-layout";

import { electronTrpcClient } from "./trpc-client";

export function renameSessionPane(pane: Pane<PaneViewerData>, title?: string) {
	const ref = paneNameRef(pane);
	if (!ref) return;
	void electronTrpcClient.sessionNames.rename
		.mutate({ ref, title: title ?? null })
		.catch((error: Error) =>
			toast.error(`Could not rename session: ${error.message}`),
		);
}
/** A multi-pane group's explicit name still belongs to the group. */
export function renameSessionTab(
	tab: Tab<PaneViewerData>,
	registry: PaneRegistry<PaneViewerData>,
	title?: string,
) {
	const panes = Object.values(tab.panes);
	if (panes.length !== 1 || !registry[panes[0].kind]?.onRename) return false;
	registry[panes[0].kind].onRename?.(panes[0], title);
	return true;
}
