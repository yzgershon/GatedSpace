import { DndContext } from "@dnd-kit/core";
import type { PaneRegistry } from "@superset/panes";
import { Globe } from "lucide-react";
import { useStore } from "zustand";
import { ToolPanel } from "../../src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/components/WorkspaceToolPanels/components/ToolPanel/ToolPanel";
import { createToolPanels } from "../../src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/components/WorkspaceToolPanels/tool-panel-store";
import type { PaneViewerData } from "../../src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/types";
import "../../src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/components/WorkspaceToolPanels/tool-panels.css";
const tools = createToolPanels({
	key: "compact-tabs-fixture",
	createTerminal: async () => "fixture-terminal",
});
const titles = [
	"KosaCalcs · Accounts",
	"Live code layout",
	"Study84 · Assembly",
	"Flow dictation",
	"GatedSpace · Settings",
	"Filtrsoft dashboard",
	"Workspace collections",
	"Session status",
	"Composer preview",
];
for (const [index, title] of titles.entries())
	tools.add("right", {
		id: `preview-${index + 1}`,
		kind: "browser",
		titleOverride: title,
		data: { url: `https://example.com/${index + 1}` },
	});
const registry: PaneRegistry<PaneViewerData> = {
	browser: {
		getTitle: () => "Browser",
		getTabIcon: () => <Globe size={16} />,
		renderPane: () => null,
	},
};
export function ToolTabsFixture() {
	const tabs = useStore(tools.store, (s) => s.tabs);
	const active = useStore(tools.state, (s) => s.right.activeTabId);
	return (
		<div className="tool-tabs-fixture">
			<DndContext>
				<ToolPanel
					side="right"
					tools={tools}
					tabs={tabs}
					registry={registry}
					activeTabId={active}
					open
				>
					<div
						style={{
							padding: 12,
							fontSize: 12,
							color: "var(--muted-foreground)",
						}}
					>
						Select a titled preview tab. Arrows reveal the rest. Add and Expand
						stay visible.
					</div>
				</ToolPanel>
			</DndContext>
		</div>
	);
}
