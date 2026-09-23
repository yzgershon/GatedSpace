import { useStore } from "zustand";
import { CodexTurnReview } from "../../src/renderer/components/CodexSession/components/CodexTurnReview";
import { openTaskReview } from "../../src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/components/WorkspaceToolPanels/task-review-tab";
import { createToolPanels } from "../../src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/components/WorkspaceToolPanels/tool-panel-store";
import type { PaneViewerData } from "../../src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/types";
import "../../src/renderer/globals.css";
import {
	createWorkspaceStore,
	type PaneRegistry,
	Workspace,
} from "@superset/panes";
import { TooltipProvider } from "@superset/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Folder } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import { createRoot } from "react-dom/client";
import { CodexSession } from "../../src/renderer/components/CodexSession/CodexSession";
import type {
	EffortLevel,
	SessionMode,
} from "../../src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/ClaudeSessionPane/SessionComposer";
import { SessionPaneIcon } from "../../src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/ClaudeSessionPane/SessionPaneIcon";
import { SessionView } from "../../src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/ClaudeSessionPane/SessionView";
import { WorkspaceLoadingState } from "../../src/renderer/routes/_authenticated/_dashboard/v2-workspace/components/WorkspaceLoadingState";
import { useThemeStore } from "../../src/renderer/stores/theme";
import { emptyTimeline } from "../../src/shared/claude-session/timeline";
import { draculaTheme } from "../../src/shared/themes/built-in/dracula";
import { navigatorCodexItems } from "./navigator-fixture";
import { UsageFixture } from "./UsageFixture";

for (const [key, value] of Object.entries(draculaTheme.ui))
	if (typeof value === "string")
		document.documentElement.style.setProperty(
			`--${key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`,
			value,
		);
document.documentElement.classList.add("dark");
useThemeStore.getState().setTheme(draculaTheme.id);
document.body.style.cssText =
	"margin:0;background:var(--background);font-family:Inter,Segoe UI,sans-serif";
const container = document.createElement("main");
container.style.cssText =
	"height:100vh;width:100%;background:var(--card);--gs-pane-title-size:17px;--gs-pane-header-height:52px;--gs-pane-radius:12px;--gs-pane-inset:9px";
document.body.append(container);
const workspace = createWorkspaceStore<Record<string, never>>();
workspace.getState().addTab({
	id: "codex-layout",
	panes: [{ id: "fixture", kind: "codex", data: {} }],
});
function ClaudeFixture() {
	const [permissions, setPermissions] = useState(
		location.search.includes("permission")
			? [
					{
						id: "claude-browser-request",
						tool: "mcp__gatedspace_browser__browser_open",
						input: { url: "http://localhost:3000" },
					},
				]
			: [],
	);
	useEffect(() => {
		const answer = () => setPermissions([]);
		window.addEventListener("fixture-claude-permission", answer);
		return () =>
			window.removeEventListener("fixture-claude-permission", answer);
	}, []);
	const [mode, setMode] = useState<SessionMode>("acceptEdits");
	const [effort, setEffort] = useState<EffortLevel>("xhigh");
	const [fast, setFast] = useState(false);
	const timeline = useMemo(
		() => ({
			...emptyTimeline(),
			permissions,
			header: {
				sessionId: "claude-fixture",
				model: "Claude Opus",
				cwd: "C:/Dev/superset",
				permissionMode: mode,
				slashCommands: ["model", "review"],
				skills: [],
				agents: [],
				mcpServers: [],
			},
		}),
		[permissions, mode],
	);
	return (
		<SessionView
			draftKey="claude-fixture"
			timeline={timeline}
			mode={mode}
			effort={effort}
			fast={fast}
			onFastChange={async (value) => setFast(value)}
			onSend={() => {}}
			onInterrupt={() => {}}
			onModeChange={setMode}
			onEffortChange={setEffort}
			onRunCommand={async () => "Set model to opus"}
		/>
	);
}
const tools = createToolPanels({
	key: "fixture-review",
	createTerminal: async () => "fixture-terminal",
});
const reviewRegistry: PaneRegistry<PaneViewerData> = {
	"codex-review": {
		getTitle: () => "Review",
		renderPane: ({ pane }) =>
			"review" in pane.data ? (
				<CodexTurnReview review={pane.data.review} />
			) : null,
	},
};
function FixtureWorkspace() {
	useEffect(() => tools.connect(), []);
	const right = useStore(tools.state, (s) => s.right);
	return (
		<div style={{ display: "flex", height: "100%", minWidth: 0 }}>
			<div style={{ flex: 1, minWidth: 0 }}>
				<Workspace store={workspace} registry={registry} showTabBar={false} />
			</div>
			{right.open && (
				<aside
					aria-label="Review sidebar"
					style={{
						width: "45%",
						minWidth: 0,
						borderLeft: "1px solid var(--border)",
						display: "flex",
						flexDirection: "column",
					}}
				>
					<button type="button" onClick={() => tools.setOpen("right", false)}>
						Close review
					</button>
					<div style={{ flex: 1, minHeight: 0 }}>
						<Workspace store={tools.store} registry={reviewRegistry} />
					</div>
				</aside>
			)}
		</div>
	);
}
const registry: PaneRegistry<Record<string, never>> = {
	codex: {
		getTitle: () => "Codex",
		getIcon: () => <SessionPaneIcon agentId="codex" />,
		renderHeaderLead: () => <Folder aria-label="Workspace folder" size={20} />,
		renderPane: (ctx) => (
			<CodexSession
				paneId={ctx.pane.id}
				cwd="C:\\Dev\\superset"
				onSessionId={() => {}}
				onReviewChanges={(review) => {
					openTaskReview(tools, review);
				}}
			/>
		),
	},
	neighbor: {
		getIcon: () => <SessionPaneIcon agentId="claude" />,
		renderHeaderLead: () => <Folder aria-label="Workspace folder" size={20} />,
		getTitle: () =>
			location.search.includes("paired") ? "Claude" : "Terminal",
		renderPane: () =>
			location.search.includes("paired") ? (
				<ClaudeFixture />
			) : (
				<div className="flex-1 p-4">PS C:\Dev\superset&gt;</div>
			),
	},
};
Object.assign(window, {
	codexLayout: {
		split: () =>
			workspace.getState().splitPane({
				tabId: "codex-layout",
				paneId: "fixture",
				position: "right",
				newPane: { id: "neighbor", kind: "neighbor", data: {} },
			}),
		zoom: (scale: number) => {
			container.style.zoom = String(scale);
			container.style.height = `${100 / scale}vh`;
			container.style.width = `${100 / scale}%`;
		},
		maximize: () =>
			workspace
				.getState()
				.toggleMaximizePane({ tabId: "codex-layout", paneId: "fixture" }),
	},
});
if (location.search.includes("navigator")) {
	(
		window as unknown as { setCodexActivityFixture(patch: unknown): void }
	).setCodexActivityFixture({ items: navigatorCodexItems });
}
createRoot(container).render(
	<QueryClientProvider client={new QueryClient()}>
		<TooltipProvider>
			<DndProvider backend={HTML5Backend}>
				{location.search.includes("usage") ? (
					<UsageFixture />
				) : location.search.includes("loading") ? (
					<WorkspaceLoadingState />
				) : (
					<FixtureWorkspace />
				)}
			</DndProvider>
		</TooltipProvider>
	</QueryClientProvider>,
);
