import {
	spellingSuggestions,
	warmAutocorrectDictionary,
} from "renderer/components/SessionComposerControls/autocorrect-dictionary-loader";
// Real components; simulated provider IPC. No agent turns or account operations.
import "renderer/globals.css";
import {
	createWorkspaceStore,
	type PaneRegistry,
	Workspace,
} from "@superset/panes";
import { claudeIcon, codexIcon } from "@superset/ui/icons/preset-icons";
import { TooltipProvider } from "@superset/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import { createRoot } from "react-dom/client";
import { CodexComposer } from "renderer/components/CodexSession/components/CodexComposer/CodexComposer";
import { agentAccent } from "renderer/lib/agent-accent";
import { TabRail } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/components/TabRail/TabRail";
import { SessionComposer } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/ClaudeSessionPane/SessionComposer";
import { useChatPreferencesStore } from "renderer/stores/chat-preferences";
import { useThemeStore } from "renderer/stores/theme/store";

useThemeStore.persist.onFinishHydration(() =>
	useThemeStore.getState().setTheme("dracula"),
);
useThemeStore.getState().setTheme("dracula");
const store = createWorkspaceStore();
for (const title of [
	"Portfolio",
	"Yuta",
	"WWWWWWWWWWWWWWW",
	"A long project title",
	"College",
	"GS Edits",
]) {
	store.getState().addTab({
		titleOverride: title,
		panes: [
			{ id: `${title}-codex`, kind: "session", data: { provider: "codex" } },
			{ id: `${title}-claude`, kind: "session", data: { provider: "claude" } },
		],
	});
	const tab = store.getState().tabs.at(-1);
	if (tab?.layout && "direction" in tab.layout)
		tab.layout.direction = "horizontal";
}
store.getState().setActiveTab(store.getState().tabs[0].id);
Object.assign(window, {
	layoutFixture: {
		store,
		preferences: useChatPreferencesStore,
		warmDictionary: warmAutocorrectDictionary,
		suggestions: spellingSuggestions,
	},
});
const registry: PaneRegistry = {
	session: {
		getTitle: (pane) =>
			pane.data.provider === "codex"
				? "Build the interface"
				: "Review the details",
		getAccent: ({ pane }) => agentAccent(pane.data.provider),
		getTabIcon: (pane) => (
			<img
				src={pane.data.provider === "codex" ? codexIcon : claudeIcon}
				alt=""
				width="28"
				height="28"
			/>
		),
		renderPane: ({ pane }) => (
			<div
				id={pane.data.provider}
				style={{
					display: "flex",
					width: "100%",
					flexDirection: "column",
					height: "100%",
					minWidth: 0,
				}}
			>
				<div
					style={{
						flex: 1,
						padding: 24,
						color: "var(--muted-foreground)",
						fontSize: 14,
					}}
				>
					Local UI check - {pane.data.provider === "codex" ? "Codex" : "Claude"}
				</div>
				{pane.data.provider === "codex" ? (
					<CodexComposer
						paneId={pane.id}
						state={{
							status: "idle",
							key: pane.id,
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
						onError={console.error}
					/>
				) : (
					<SessionComposer
						draftKey={pane.id}
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
				)}
			</div>
		),
	},
};
const client = new QueryClient();
const root = document.getElementById("root");
if (!root) throw new Error("Missing fixture root");
createRoot(root).render(
	<TooltipProvider>
		<QueryClientProvider client={client}>
			<DndProvider backend={HTML5Backend}>
				<main
					style={{
						height: "100vh",
						display: "flex",
						flexDirection: "column",
						gap: 16,
						padding: 16,
						background: "#111218",
					}}
				>
					<header
						style={{ display: "flex", justifyContent: "center", minHeight: 50 }}
					>
						<TabRail store={store} registry={registry} onNewGroup={() => {}} />
					</header>
					<div
						style={
							{
								flex: 1,
								minHeight: 0,
								"--gs-pane-header-height": "48px",
								"--gs-pane-inset": "8px",
								"--gs-pane-radius": "12px",
								"--gs-pane-surface": "#282a36",
								"--gs-pane-border-width": "1px",
								"--gs-pane-ring-width": "1px",
								"--gs-pane-ring-glow": "0px",
							} as React.CSSProperties
						}
					>
						<Workspace store={store} registry={registry} showTabBar={false} />
					</div>
				</main>
			</DndProvider>
		</QueryClientProvider>
	</TooltipProvider>,
);
