import { DndContext } from "@dnd-kit/core";
import { type PaneRegistry, Workspace } from "@superset/panes";
import { TooltipProvider } from "@superset/ui/tooltip";
import { useEffect } from "react";
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import { useStore } from "zustand";
import { ToolPanel } from "../../src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/components/WorkspaceToolPanels/components/ToolPanel/ToolPanel";
import { createToolPanels } from "../../src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/components/WorkspaceToolPanels/tool-panel-store";
import { BrowserPaneToolbar } from "../../src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/BrowserPane/BrowserPane";
import type { PaneViewerData } from "../../src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/types";

const tools = createToolPanels({
	key: "split-preview-fixture",
	createTerminal: async () => "fixture",
});
const closed: string[] = [];
let canClose = true;
function Page({ id }: { id: string }) {
	// Page pixels are simulated. Native webviews live outside the React tree;
	// this fixture verifies surviving pane identity and close lifecycle, not page DOM persistence.
	return <div className="p-4">{id}</div>;
}
const registry: PaneRegistry<PaneViewerData> = {
	browser: {
		getTitle: (pane) => pane.id,
		renderToolbar: (ctx) => <BrowserPaneToolbar ctx={ctx} />,
		renderPane: (ctx) => <Page id={ctx.pane.id} />,
		onBeforeClose: () => canClose,
		onAfterClose: (pane) => {
			closed.push(pane.id);
		},
	},
};
function reset(position: "right" | "bottom" = "right", count = 2) {
	for (const tab of tools.store.getState().tabs)
		tools.store.getState().removeTab(tab.id);
	tools.add("right", {
		id: "preview-left",
		kind: "browser",
		data: { url: "https://example.com/left" },
	});
	const tab = tools.store.getState().tabs[0];
	for (let i = 1; i < count; i++)
		tools.store.getState().splitPane({
			tabId: tab.id,
			paneId: "preview-left",
			position,
			newPane: {
				id: i === 1 ? "preview-right" : `preview-${i}`,
				kind: "browser",
				data: { url: `https://example.com/${i}` },
			},
		});
	closed.length = 0;
	canClose = true;
}
reset();
Object.assign(window, {
	splitPreviewFixture: {
		reset,
		closed,
		allowClose: (allow: boolean) => {
			canClose = allow;
		},
		state: () => tools.store.getState().tabs[0],
		maximize: (paneId: string) =>
			tools.store.getState().toggleMaximizePane({
				tabId: tools.store.getState().tabs[0].id,
				paneId,
			}),
	},
});

export function SplitPreviewFixture() {
	useEffect(() => tools.connect(), []);
	const tabs = useStore(tools.store, (s) => s.tabs);
	const active = useStore(tools.state, (s) => s.right.activeTabId);
	return (
		<TooltipProvider>
			<DndProvider backend={HTML5Backend}>
				<DndContext>
					<div
						data-split-preview
						style={{
							width: "100%",
							height: 650,
							display: "flex",
							flexDirection: "column",
						}}
					>
						<ToolPanel
							side="right"
							tools={tools}
							tabs={tabs}
							registry={registry}
							activeTabId={active}
							open
						>
							<Workspace
								store={tools.store}
								registry={registry}
								showTabBar={false}
								className="gs-tool-view"
							/>
						</ToolPanel>
					</div>
				</DndContext>
			</DndProvider>
		</TooltipProvider>
	);
}
