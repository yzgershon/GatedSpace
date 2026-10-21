import {
	createWorkspaceStore,
	type PaneRegistry,
	Workspace,
} from "@superset/panes";
import { useEffect } from "react";
import { CodexSession } from "../../src/renderer/components/CodexSession/CodexSession";
import { createToolPanels } from "../../src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/components/WorkspaceToolPanels/tool-panel-store";
import { WorkspaceToolPanels } from "../../src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/components/WorkspaceToolPanels/WorkspaceToolPanels";
import type { PaneViewerData } from "../../src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/types";

const main = createWorkspaceStore<PaneViewerData>();
main.getState().addTab({
	id: "main",
	panes: [
		{
			id: "fixture",
			kind: "session",
			data: { provider: "codex" },
			titleOverride: "Composer integration",
		},
	],
});
const tools = createToolPanels({
	key: "activity",
	createTerminal: async () => "unused",
});
const tabId = tools.add("right", {
	id: "preview",
	kind: "browser",
	data: { url: "about:blank", agentSessionKey: "codex:fixture" },
});
const registry: PaneRegistry<PaneViewerData> = {
	session: {
		getTitle: () => "Codex",
		renderPane: () => (
			<CodexSession
				paneId="fixture"
				cwd="C:/Dev/superset"
				onSessionId={() => {}}
			/>
		),
	},
	browser: {
		getTitle: () => "Preview",
		renderPane: () => (
			<div
				data-testid="preview-content"
				style={{ flex: 1, minHeight: 0, background: "var(--background)" }}
			>
				Preview content
			</div>
		),
	},
};
Object.assign(window, {
	expandActivityPreview: () =>
		tools.store.getState().toggleMaximizePane({ tabId, paneId: "preview" }),
});
export function ActivityFixture() {
	useEffect(() => tools.connect(), []);
	return (
		<WorkspaceToolPanels
			tools={tools}
			mainStore={main}
			registry={registry}
			onResizing={() => {}}
		>
			<Workspace store={main} registry={registry} showTabBar={false} />
		</WorkspaceToolPanels>
	);
}
