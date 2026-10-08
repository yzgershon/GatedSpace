import { createWorkspaceStore, type PaneRegistry } from "@superset/panes";
import { TooltipProvider } from "@superset/ui/tooltip";
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import claude from "../../../../packages/ui/src/assets/icons/preset-icons/claude.svg";
import codex from "../../../../packages/ui/src/assets/icons/preset-icons/codex.svg";
import { TabRail } from "../../src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/components/TabRail/TabRail";
import type {
	PaneViewerData,
	SessionPaneData,
} from "../../src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/types";

const store = createWorkspaceStore<PaneViewerData>();
function addTab(title = "New session") {
	store.getState().addTab({
		titleOverride: title,
		panes: [{ kind: "session", data: { provider: "codex" } }],
	});
}
for (const title of [
	"GS Edits",
	"Filtrsoft",
	"Sortie",
	"Emails/texts",
	"Research",
	"Mobile",
])
	addTab(title);
store.getState().setActiveTab(store.getState().tabs[0].id);
const registry: PaneRegistry<PaneViewerData> = {
	session: {
		renderPane: () => null,
		getTitle: () => "Session",
		getTabIcon: (pane) => (
			<img
				src={
					(pane.data as SessionPaneData).provider === "claude" ? claude : codex
				}
				width="18"
				height="18"
				alt=""
			/>
		),
	},
};

export function HeaderPreviewTabs() {
	return (
		<TooltipProvider>
			<DndProvider backend={HTML5Backend}>
				<TabRail
					store={store}
					registry={registry}
					onNewGroup={() => addTab()}
					onCloseGroup={(id) => store.getState().removeTab(id)}
				/>
			</DndProvider>
		</TooltipProvider>
	);
}
