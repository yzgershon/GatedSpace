import "renderer/globals.css";
import { state } from "virtual:fixture";
import { createWorkspaceStore, Workspace } from "@superset/panes";
import { TooltipProvider } from "@superset/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import { createRoot } from "react-dom/client";
import { CodexComposer } from "renderer/components/CodexSession/components/CodexComposer/CodexComposer";
import { OPEN_WHATS_NEW, WhatsNew } from "renderer/components/WhatsNew";
import { SessionComposer } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/ClaudeSessionPane/SessionComposer";
import { draculaTheme } from "shared/themes/built-in/dracula";

for (const [key, value] of Object.entries(draculaTheme.ui))
	if (typeof value === "string")
		document.documentElement.style.setProperty(
			`--${key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`,
			value,
		);
document.documentElement.classList.add("dark");
const store = createWorkspaceStore();
for (const id of ["a", "b"]) {
	store.getState().addTab({
		id,
		panes: [
			{ id: `${id}1`, kind: "test", data: {} },
			{ id: `${id}2`, kind: "test", data: {} },
		],
	});
	const tab = store.getState().getTab(id);
	tab.layout.direction = "horizontal";
	store.getState().resizeSplit({
		tabId: id,
		path: [],
		splitPercentage: id === "a" ? 50 : 35,
	});
}
store.getState().setActiveTab("a");
state.writes = 0;
store.subscribe(() => state.writes++);
state.store = store;
const registry = {
	test: {
		getTitle: (p) => p.id,
		renderPane: ({ pane }) => <div style={{ padding: 24 }}>Pane {pane.id}</div>,
	},
};
const client = new QueryClient();
function Preview() {
	const [error, setError] = useState("");
	return (
		<TooltipProvider>
			<QueryClientProvider client={client}>
				<DndProvider backend={HTML5Backend}>
					<main style={{ padding: 24 }}>
						<WhatsNew />
						<nav>
							<button
								type="button"
								onClick={() => store.getState().setActiveTab("a")}
							>
								Tab A
							</button>{" "}
							<button
								type="button"
								onClick={() => store.getState().setActiveTab("b")}
							>
								Tab B
							</button>{" "}
							<button
								type="button"
								onClick={() =>
									store
										.getState()
										.equalizeTab({ tabId: store.getState().activeTabId })
								}
							>
								Equalize
							</button>{" "}
							<button
								type="button"
								onClick={() => window.dispatchEvent(new Event(OPEN_WHATS_NEW))}
							>
								Release notes
							</button>
						</nav>
						<div style={{ height: 300 }}>
							<Workspace store={store} registry={registry} showTabBar={false} />
						</div>
						<div id="codex">
							<p id="codex-error">{error}</p>
							<CodexComposer
								paneId="test-codex"
								state={{
									status: "idle",
									key: "test-codex",
									cwd: "",
									items: [],
									approvals: [],
									error: null,
								}}
								models={[
									{
										id: "test-model",
										name: "Test",
										efforts: ["high"],
										defaultEffort: "high",
									},
								]}
								onError={setError}
							/>
						</div>
						<div id="claude">
							<SessionComposer
								draftKey="test-claude"
								model="opus"
								status="idle"
								slashCommands={[]}
								mode="manual"
								effort="high"
								onSend={() => {}}
								onInterrupt={() => {}}
								onModeChange={() => {}}
								onEffortChange={() => {}}
							/>
						</div>
					</main>
				</DndProvider>
			</QueryClientProvider>
		</TooltipProvider>
	);
}
createRoot(document.getElementById("root")).render(<Preview />);
