import type { RendererContext } from "@superset/panes";
import { LauncherPane } from "../../src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/LauncherPane";
import { useWorkspacePaneOpeners } from "../../src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/useWorkspacePaneOpeners/useWorkspacePaneOpeners";
import type { PaneViewerData } from "../../src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/types";
import type { V2TerminalPresetRow } from "../../src/renderer/routes/_authenticated/providers/CollectionsProvider/dashboardSidebarLocal";

const agents: V2TerminalPresetRow[] = ["codex", "claude"].map((name) => ({
	id: name,
	name,
	agentId: name,
	cwd: "",
	commands: [],
	projectIds: null,
	executionMode: "new-tab",
	tabOrder: 0,
	createdAt: new Date(),
}));
export const launcherControl = {
	finish: null as null | (() => void),
	fail: null as null | (() => void),
	count: 0,
};

export function LauncherFixture({
	ctx,
}: {
	ctx: RendererContext<PaneViewerData>;
}) {
	const openers = useWorkspacePaneOpeners({
		store: ctx.store,
		launcher: {
			create: () => {
				launcherControl.count++;
				return new Promise<string>((resolve, reject) => {
					launcherControl.finish = () => resolve("fixture-terminal");
					launcherControl.fail = () =>
						reject(new Error("Fixture creation failure"));
				});
			},
		},
		newTabPresets: [],
		executePreset: () => {},
	});
	const options = {
		target: "active-pane" as const,
		paneTarget: { tabId: ctx.tab.id, paneId: ctx.pane.id },
	};
	const launch = (preset: V2TerminalPresetRow) =>
		openers.addSessionTab({
			...options,
			provider: preset.name === "codex" ? "codex" : "claude",
		});
	return (
		<LauncherPane
			agents={agents}
			canOpenAsPane={() => true}
			onLaunchAgent={launch}
			onLaunchAgentAs={(preset, mode) =>
				mode === "pane" ? launch(preset) : openers.addTerminalTab(options)
			}
			onLaunchAll={() => {
				for (const agent of agents) launch(agent);
			}}
			onOpenTerminal={() => openers.addTerminalTab(options)}
			onOpenBrowser={() => openers.addBrowserTab(options)}
			onOpenQuickOpen={() => {}}
			onOpenSessions={() => {}}
			onDone={() => {
				void ctx.actions.close();
			}}
		/>
	);
}
