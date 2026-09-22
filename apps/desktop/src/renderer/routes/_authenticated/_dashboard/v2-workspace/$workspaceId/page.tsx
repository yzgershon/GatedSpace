import { type PaneRegistry, Workspace } from "@superset/panes";
import { workspaceTrpc } from "@superset/workspace-client";
import { createFileRoute } from "@tanstack/react-router";
import { Folder, GitCompareArrows, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { useQuickOpenStore } from "renderer/commandPalette/ui/QuickOpen/quickOpenStore";
import { CommandPalette } from "renderer/components/CommandPalette";
import { useSkinTokens } from "renderer/hooks/useSkinTokens";
import { useV2AgentConfigs } from "renderer/hooks/useV2AgentConfigs";
import { useV2UserPreferences } from "renderer/hooks/useV2UserPreferences";
import { useHotkey } from "renderer/hotkeys";
import { resolveV2PresetIconKey } from "renderer/lib/preset-icon-key";
import type { V2TerminalPresetRow } from "renderer/routes/_authenticated/providers/CollectionsProvider/dashboardSidebarLocal";
import { useLocalHostService } from "renderer/routes/_authenticated/providers/LocalHostServiceProvider";
import {
	sessionFromPane,
	useFocusedSession,
} from "renderer/stores/focused-session";
import type { PresetOpenTarget } from "renderer/stores/tabs/preset-launch";
import { getV2NotificationSourcesForTab } from "renderer/stores/v2-notifications";
import { useStore } from "zustand";
import { useWorkspace } from "../providers/WorkspaceProvider";
import { BackgroundTerminalsButton } from "./components/BackgroundTerminalsButton";
import { TabPaneList } from "./components/TabPaneList";
import { TabRail } from "./components/TabRail";
import { V2NotificationStatusIndicator } from "./components/V2NotificationStatusIndicator";
import { V2PresetsBar } from "./components/V2PresetsBar";
import { V2WorkspaceRunButton } from "./components/V2WorkspaceRunButton";
import { WorkspaceEmptyState } from "./components/WorkspaceEmptyState";
import { WorkspaceMissingWorktreeState } from "./components/WorkspaceMissingWorktreeState";
import { WorkspaceToolPanels } from "./components/WorkspaceToolPanels";
import { ChangesTool } from "./components/WorkspaceToolPanels/components/ChangesTool/ChangesTool";
import { FilesTool } from "./components/WorkspaceToolPanels/components/FilesTool/FilesTool";
import { mainPaneMinimum } from "./components/WorkspaceToolPanels/tool-panel-store";
import { useToolPanels } from "./components/WorkspaceToolPanels/useToolPanels";
import { useBrowserShellInteractionPassthrough } from "./hooks/useBrowserShellInteractionPassthrough";
import { useClearActivePaneAttention } from "./hooks/useClearActivePaneAttention";
import { useConsumeAutomationRunLink } from "./hooks/useConsumeAutomationRunLink";
import { useConsumeOpenUrlRequest } from "./hooks/useConsumeOpenUrlRequest";
import { useDefaultContextMenuActions } from "./hooks/useDefaultContextMenuActions";
import { useDefaultPaneActions } from "./hooks/useDefaultPaneActions";
import { useDirtyTabCloseGuard } from "./hooks/useDirtyTabCloseGuard";
import { useFocusPaneIntentConsumer } from "./hooks/useFocusPaneIntentConsumer";
import { usePaneRegistry } from "./hooks/usePaneRegistry";
import { renderBrowserTabIcon } from "./hooks/usePaneRegistry/components/BrowserPane";
import type { NewTabPaneActions } from "./hooks/usePaneRegistry/components/LauncherPane";
import { usePickElementConsumer } from "./hooks/usePickElementConsumer";
import { usePublishWorkspaceGroups } from "./hooks/usePublishWorkspaceGroups";
import { useRunCommandIntentConsumer } from "./hooks/useRunCommandIntentConsumer";
import { useSendPageToSessionConsumer } from "./hooks/useSendPageToSessionConsumer";
import { useSlotElement } from "./hooks/useSlotElement";
import { useV2PresetExecution } from "./hooks/useV2PresetExecution";
import { useV2TerminalLauncher } from "./hooks/useV2TerminalLauncher";
import { useV2WorkspacePaneLayout } from "./hooks/useV2WorkspacePaneLayout";
import { useV2WorkspaceRun } from "./hooks/useV2WorkspaceRun";
import { useWorkspaceFileNavigation } from "./hooks/useWorkspaceFileNavigation";
import { useWorkspaceHotkeys } from "./hooks/useWorkspaceHotkeys";
import { useWorkspacePaneOpeners } from "./hooks/useWorkspacePaneOpeners";
import { WorkspaceGitStatusProvider } from "./providers/WorkspaceGitStatusProvider";
import { FileDocumentStoreProvider } from "./state/fileDocumentStore";
import type { FilePaneData, PaneViewerData, SessionPaneData } from "./types";
import type { V2WorkspaceUrlOpenTarget } from "./utils/openUrlInV2Workspace";

interface WorkspaceSearch {
	terminalId?: string;
	chatSessionId?: string;
	focusRequestId?: string;
	openUrl?: string;
	openUrlTarget?: V2WorkspaceUrlOpenTarget;
	openUrlRequestId?: string;
}

function parseOpenUrlTarget(
	value: unknown,
): V2WorkspaceUrlOpenTarget | undefined {
	if (value === "current-tab" || value === "new-tab") return value;
	return undefined;
}

function parseNonEmptyString(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

export const Route = createFileRoute(
	"/_authenticated/_dashboard/v2-workspace/$workspaceId/",
)({
	component: V2WorkspacePage,
	validateSearch: (raw: Record<string, unknown>): WorkspaceSearch => ({
		terminalId: parseNonEmptyString(raw.terminalId),
		chatSessionId: parseNonEmptyString(raw.chatSessionId),
		focusRequestId: parseNonEmptyString(raw.focusRequestId),
		openUrl: parseNonEmptyString(raw.openUrl),
		openUrlTarget: parseOpenUrlTarget(raw.openUrlTarget),
		openUrlRequestId: parseNonEmptyString(raw.openUrlRequestId),
	}),
});

function V2WorkspacePage() {
	const { workspace } = useWorkspace();
	const workspaceStatusQuery = workspaceTrpc.workspace.get.useQuery(
		{ id: workspace.id },
		{
			refetchOnWindowFocus: true,
			retry: false,
		},
	);

	if (workspaceStatusQuery.data?.worktreeExists === false) {
		return (
			<WorkspaceMissingWorktreeState
				workspaceId={workspace.id}
				workspaceName={workspace.name}
				branch={workspace.branch}
				worktreePath={workspaceStatusQuery.data?.worktreePath}
				onRefresh={() => {
					void workspaceStatusQuery.refetch();
				}}
				isRefreshing={workspaceStatusQuery.isFetching}
			/>
		);
	}

	return <V2WorkspaceContent />;
}

function V2WorkspaceContent() {
	const {
		terminalId,
		chatSessionId,
		focusRequestId,
		openUrl,
		openUrlTarget,
		openUrlRequestId,
	} = Route.useSearch();
	const { workspace } = useWorkspace();
	const workspaceId = workspace.id;
	const workspaceCwdQuery = workspaceTrpc.workspace.get.useQuery(
		{ id: workspace.id },
		{ staleTime: 30_000 },
	);

	const { preferences: v2UserPreferences, setShowPresetsBar } =
		useV2UserPreferences();
	const showPresetsBar = v2UserPreferences.showPresetsBar;
	const {
		presetsPlacement,
		paneGap,
		paneRadius,
		paneElevated,
		paneBorder,
		paneSurface,
		paneRingWidth,
		paneRingGlow,
		paneHeaderStatus,
		tabStrip,
	} = useSkinTokens();
	/*
	 * The panes package reads these and knows nothing else about the
	 * appearance. Defaults are 0/transparent, so an unset variable is the
	 * edge-to-edge layout — which is what makes "VS Code Style" a genuine no-op
	 * rather than a second code path.
	 */
	const paneChromeVars = {
		"--gs-pane-header-height": "58px",
		"--gs-pane-title-size": "17px",
		"--gs-pane-action-size": "32px",
		"--gs-pane-inset": `${paneGap / 2}px`,
		"--gs-pane-radius": `${paneRadius}px`,
		"--gs-pane-border-width": paneBorder ? "1px" : "0px",
		/*
		 * The header's orange wash and its 2px edge bar, both off under the card
		 * layout: the status dot and the agent mark at the head of the row say
		 * whose pane it is, and the wash was the loudest thing in the window.
		 */
		"--gs-pane-header-tint": paneHeaderStatus ? "0%" : "17%",
		"--gs-pane-header-bar": paneHeaderStatus ? "0" : "0.45",
		"--gs-pane-ring-width": `${paneRingWidth}px`,
		"--gs-pane-ring-glow": `${paneRingGlow}px`,
		/*
		 * The card's own surface, and the single most load-bearing value in the
		 * skin.
		 *
		 * 1.17.50 shipped the gutter and the radius but left the card painting
		 * `--background`, the same colour as the app behind it, and tried to buy
		 * the separation by darkening the WELL 18% instead. On a #151110 ground
		 * that is a four-value step, which is invisible — so the panes read as
		 * rounded regions rather than raised cards, and the whole look collapsed.
		 *
		 * Lifting the CARD is what "raised" means, so that is what this does:
		 * a step from `--background` toward `--card`, landing near the #1c1918 the
		 * preview used. The well goes back to plain `--background`, because with
		 * the card lifted it no longer has to do the work.
		 *
		 * `--gs-pane-surface` is consumed by REDEFINING `--background` inside the
		 * pane (see Pane.tsx), so every `bg-background` descendant follows without
		 * being touched, and `--card` keeps its own value one step further up for
		 * the insets that sit on top of the card.
		 *
		 * Set for BOTH skins, and `var(--background)` when flush, so the variable
		 * is always present and the flush case resolves to exactly the colour the
		 * pane painted before. Custom properties are substituted where they are
		 * DECLARED, so both branches resolve against this element's `--background`
		 * — the app's — and are inherited down as literal colours.
		 */
		"--gs-pane-surface":
			paneSurface === "raised"
				? "color-mix(in oklab, var(--background) 42%, var(--card))"
				: "var(--background)",
		"--gs-pane-shadow": paneElevated
			? "0 8px 26px -12px rgb(0 0 0 / 0.7)"
			: "none",
		/*
		 * The well the cards float on, and it has to be DARKER than the app.
		 *
		 * .51 lifted the card and left the well at plain `--background`, on the
		 * reasoning that only one of the two needed to move. That was wrong in
		 * practice: the tab bar, the top bar and the gutter were then all the
		 * same colour, so the 14px gap between two panes had nothing to read
		 * against and the cards still looked tiled. A recessed trough is what
		 * makes a card look lifted off something rather than cut into it.
		 */
		"--gs-pane-well": paneElevated
			? "color-mix(in oklab, var(--background) 62%, black)"
			: "transparent",
		/*
		 * Tabs, on the same contract. "slab" is the full-height rectangle with a
		 * divider on its right; "chip" insets it from the bar, rounds it, drops
		 * the divider and gives the active one a fill you can actually see.
		 *
		 * The divider is what made the strip read as a row of slabs: with eight
		 * of them the bar is a picket fence, and the active tab — differing only
		 * by a 30%-opacity border colour — was the least visible thing in it.
		 */
		/*
		 * The tab strip is the VS Code layout's only, so these are its values
		 * outright rather than a branch.
		 *
		 * They were a `tabShape === "chip"` ternary while Liquid Glass had a
		 * strip of rounded chips. It has a group switcher in the top bar now and
		 * no strip at all, so the chip half described something that cannot
		 * render. Git has it if the strip ever comes back.
		 */
		"--gs-tab-radius": "0px",
		"--gs-tab-margin": "0px",
		"--gs-tab-margin-x": "0px",
		/*
		 * `borderRightWidth` is applied AFTER the all-sides `borderWidth` in
		 * TabItem, so it is the last word on the right edge: a slab wants a
		 * divider and nothing else (all-sides 0 + right 1).
		 */
		"--gs-tab-divider-width": "1px",
		"--gs-tab-active-bg": "color-mix(in oklab, var(--border) 30%, transparent)",
		"--gs-tab-idle-bg": "transparent",
		"--gs-tab-border-width": "0px",
		"--gs-tab-active-border": "transparent",
		"--gs-tabbar-border-width": "1px",
	} as React.CSSProperties;
	// Only one home at a time, or the presets would render twice.
	const presetsInHeader = presetsPlacement === "header";
	const { store } = useV2WorkspacePaneLayout();
	const mainLayout = useStore(
		store,
		(state) => state.tabs.find((tab) => tab.id === state.activeTabId)?.layout,
	);
	useClearActivePaneAttention({ store });
	useRunCommandIntentConsumer({ store, workspaceId });
	useSendPageToSessionConsumer({ store });
	useFocusPaneIntentConsumer({ store });
	usePickElementConsumer({ store });
	const launcher = useV2TerminalLauncher();
	const { activeHostUrl } = useLocalHostService();
	const tools = useToolPanels(workspaceId, activeHostUrl, launcher, () => {
		const pane = store.getState().getActivePane()?.pane;
		return pane?.kind === "session"
			? {
					provider: (pane.data as SessionPaneData).provider,
					cwd: (pane.data as SessionPaneData).cwd,
				}
			: {};
	});
	const toolState = useStore(tools.state);
	useEffect(() => {
		const update = () => {
			const target =
				tools.state.getState().focus === "main" ? store : tools.store;
			const session = sessionFromPane(target.getState().getActivePane()?.pane);
			// Files/browser tools keep the last agent's limits visible.
			if (session) useFocusedSession.getState().set(session);
		};
		update();
		const cleanups = [
			store.subscribe(update),
			tools.store.subscribe(update),
			tools.state.subscribe(update),
		];
		return () => {
			for (const cleanup of cleanups) cleanup();
			useFocusedSession.getState().set(null);
		};
	}, [store, tools]);

	useEffect(
		() =>
			store.subscribe((next, previous) => {
				const active = next.getActivePane()?.pane.id;
				const previousTab = previous.tabs.find(
					(tab) => tab.id === previous.activeTabId,
				);
				if (
					next.activeTabId !== previous.activeTabId ||
					active !== previousTab?.activePaneId
				)
					tools.focus("main");
			}),
		[store, tools],
	);
	const sidebarOpen = toolState.right.open || toolState.bottom.open;
	const openFilesTool = useCallback(() => {
		void tools.open("right", "files");
	}, [tools]);
	const openFileInTools = useCallback(
		(data: FilePaneData, newTab?: boolean) => {
			if (!newTab) {
				for (const tab of tools.store.getState().tabs) {
					const pane = Object.values(tab.panes).find(
						(p) =>
							p.kind === "file" &&
							(p.data as FilePaneData).filePath === data.filePath,
					);
					if (pane) {
						tools.select(tab.id);
						tools.store
							.getState()
							.setActivePane({ tabId: tab.id, paneId: pane.id });
						return;
					}
				}
			}
			tools.add("right", { kind: "file", data });
		},
		[tools],
	);
	useClearActivePaneAttention({ store: tools.store });
	useSendPageToSessionConsumer({ store: tools.store });
	useFocusPaneIntentConsumer({ store: tools.store });
	usePickElementConsumer({ store: tools.store });
	const { data: agentConfigs } = useV2AgentConfigs(activeHostUrl);
	const {
		matchedPresets,
		newTabPresets,
		executePreset,
		resolvePresetCommands,
	} = useV2PresetExecution({
		store,
		launcher,
	});
	const workspaceRun = useV2WorkspaceRun({
		store,
		launcher,
		matchedPresets,
		resolvePresetCommands,
	});
	useConsumeAutomationRunLink({
		store,
		workspaceId,
		terminalId,
		chatSessionId,
		focusRequestId,
	});
	useConsumeOpenUrlRequest({
		store,
		url: openUrl,
		target: openUrlTarget,
		requestId: openUrlRequestId,
	});

	const {
		openFilePaneFromTreeClick,
		revealPath,
		selectedFilePath,
		pendingReveal,
		recentFiles,
		openFilePaths,
	} = useWorkspaceFileNavigation({
		store: tools.store,
		onRevealTools: openFilesTool,
		openInToolPanel: openFileInTools,
	});

	/*
	 * The new-tab pane's actions, handed over by REF rather than by value.
	 *
	 * `usePaneRegistry` is built here, above `useWorkspacePaneOpeners` and above
	 * the preset list, so those callbacks do not exist yet at this line. The ref
	 * is filled further down on every render and read by `renderPane`, which
	 * runs after the whole component body — so the pane always sees the current
	 * openers without the registry having to be rebuilt when one of them
	 * changes.
	 */
	const newTabActionsRef = useRef<NewTabPaneActions | null>(null);
	const reviewCodexChanges = useCallback(() => {
		void tools.open("right", "changes");
	}, [tools]);
	const basePaneRegistry = usePaneRegistry({
		onOpenFile: openFilePaneFromTreeClick,
		onRevealPath: revealPath,
		launcher,
		store,
		newTabActionsRef,
		onReviewChanges: reviewCodexChanges,
		workspaceCwd: workspaceCwdQuery.data?.worktreePath,
	});
	const paneRegistry = useMemo<PaneRegistry<PaneViewerData>>(
		() =>
			Object.fromEntries(
				Object.entries(basePaneRegistry).map(([kind, definition]) => [
					kind,
					definition,
				]),
			),
		[basePaneRegistry],
	);
	const defaultContextMenuActions = useDefaultContextMenuActions({
		paneRegistry,
		launcher,
		// Same query key as the page's own status query, so React Query serves
		// this from cache rather than issuing a second request.
		workspaceCwd: workspaceCwdQuery.data?.worktreePath,
	});
	const {
		openDiffPane,
		addTerminalTab,
		addBrowserTab,
		addSessionTab,
		openClaudeSessions,
		openCommentPane,
	} = useWorkspacePaneOpeners({
		store,
		launcher,
		newTabPresets,
		executePreset,
	});

	const quickOpenOpen = useQuickOpenStore(
		(s) => s.open && s.target?.workspaceId === workspaceId,
	);
	const closeQuickOpen = useQuickOpenStore((s) => s.close);
	const openQuickOpenFor = useQuickOpenStore((s) => s.openFor);
	/**
	 * The agents bar runs presets, except for Claude, which opens the session
	 * pane instead of a terminal.
	 *
	 * Only the AGENTS TOOLBAR routes through this. The + menu's Terminal submenu
	 * passes executePreset directly, because a submenu under "Terminal" that
	 * opened a session pane would be lying about what it does.
	 *
	 * Worth being precise about what this gives up. A preset is a multi-command
	 * recipe with an execution mode and a cwd override; the session pane runs one
	 * `claude`. For the shipped Claude preset those are the same thing, which is
	 * why this is safe — but a Claude preset edited into several commands would
	 * quietly lose the rest. If that ever happens, this is the line that did it.
	 */
	/**
	 * Whether a preset has a session pane as well as a terminal.
	 *
	 * Only Claude does: the session pane renders `claude`'s stream-json as a
	 * transcript, and no other agent emits it. Everything else is a terminal
	 * either way, so offering the choice for those would be offering the same
	 * thing twice.
	 */
	const canOpenAsPane = useCallback(
		(preset: V2TerminalPresetRow) =>
			["claude", "codex"].includes(
				resolveV2PresetIconKey(preset, agentConfigs ?? []) ?? "",
			),
		[agentConfigs],
	);

	const runPresetOrSession = useCallback(
		(preset: V2TerminalPresetRow, options?: { target?: PresetOpenTarget }) => {
			if (canOpenAsPane(preset)) {
				addSessionTab({
					...options,
					provider:
						resolveV2PresetIconKey(preset, agentConfigs ?? []) === "codex"
							? "codex"
							: "claude",
				});
				return;
			}
			return executePreset(preset, options);
		},
		[addSessionTab, canOpenAsPane, executePreset, agentConfigs],
	);

	/**
	 * The same launch, with the shape named instead of assumed. The new-tab
	 * launcher asks first for any preset `canOpenAsPane` covers.
	 */
	const launchAgentAs = useCallback(
		(
			preset: V2TerminalPresetRow,
			mode: "pane" | "terminal",
			options?: { target?: PresetOpenTarget },
		) => {
			if (mode === "pane") {
				addSessionTab({
					...options,
					provider:
						resolveV2PresetIconKey(preset, agentConfigs ?? []) === "codex"
							? "codex"
							: "claude",
				});
				return;
			}
			return executePreset(preset, options);
		},
		[addSessionTab, executePreset, agentConfigs],
	);

	const handleQuickOpen = useCallback(
		() => openQuickOpenFor({ workspaceId }),
		[openQuickOpenFor, workspaceId],
	);
	const handleQuickOpenChange = useCallback(
		(next: boolean) => {
			if (!next) closeQuickOpen();
		},
		[closeQuickOpen],
	);
	/*
	 * Quick Open just opens the file. It used to also force the sidebar open on
	 * the Files tab, so that the reveal (expand + highlight + scroll) would be
	 * visible — but Ctrl+T is a way to get straight to a file WITHOUT touching
	 * the tree, and hijacking the sidebar every time made a keyboard shortcut
	 * rearrange the window. Reveal-in-tree is still available on its own, via
	 * `revealPath`, which is what the terminal's directory links use.
	 */
	const handleQuickOpenSelectFile = useCallback(
		(filePath: string, openInNewTab?: boolean) => {
			openFilePaneFromTreeClick(filePath, openInNewTab);
		},
		[openFilePaneFromTreeClick],
	);
	const defaultPaneActions = useDefaultPaneActions({ tools });
	// Mirrors the group tree out to the sidebar, which cannot read this store.
	usePublishWorkspaceGroups({ workspaceId, store, registry: paneRegistry });
	const onBeforeCloseTab = useDirtyTabCloseGuard();
	/**
	 * Close a group from the switcher.
	 *
	 * Goes through `onBeforeCloseTab` rather than calling `removeTab` directly,
	 * because that guard is what stops a group holding a half-written prompt
	 * from closing silently. The strip's × went through the same check inside
	 * `Workspace`; the switcher is outside it, so it has to ask for itself.
	 */
	const closeGroup = useCallback(
		async (tabId: string) => {
			const tab = store.getState().getTab(tabId);
			if (!tab) return;
			if (!(await onBeforeCloseTab(tab))) return;
			// Re-check after the await: it may have gone while the dialog was up.
			if (!store.getState().getTab(tabId)) return;
			store.getState().removeTab(tabId);
		},
		[onBeforeCloseTab, store],
	);

	const { onSidebarResizeDragging, onWorkspaceInteractionStateChange } =
		useBrowserShellInteractionPassthrough({ sidebarOpen });

	// TopBar slot for the background-shells chip. It renders here via portal so
	// it keeps this page's context (pane store, workspace providers) while
	// appearing up in the TopBar beside the open-in button.
	const shellsSlotEl = useSlotElement("workspace-topbar-shells-slot");
	// TopBar slot for the group switcher, which IS the whole tab strip when
	// `tabStrip` is "switcher". Portaled for the same reason as the rest: it
	// needs this page's pane store.
	const tabsSlotEl = useSlotElement("workspace-topbar-tabs-slot");
	// TopBar centre slot. Under Liquid Glass the presets live up there instead
	// of on a row of their own, which reclaims ~36px of vertical space.
	const presetsSlotEl = useSlotElement("workspace-topbar-presets-slot");

	useWorkspaceHotkeys({
		store: toolState.focus === "main" ? store : tools.store,
		tools,
		matchedPresets,
		executePreset,
		addTerminalTab,
		paneRegistry,
		launcher,
	});
	useHotkey("QUICK_OPEN", handleQuickOpen);
	useHotkey("RUN_WORKSPACE_COMMAND", () => {
		void workspaceRun.toggleWorkspaceRun();
	});

	/*
	 * The agents offered on an empty workspace: the same ones the presets bar
	 * shows, in the same order. `pinnedToBar !== false` is the bar's own rule —
	 * the field is legacy "pinned" wording that the v2 UI reads as visibility,
	 * and undefined means visible.
	 */
	const emptyStateAgents = useMemo(
		() => matchedPresets.filter((preset) => preset.pinnedToBar !== false),
		[matchedPresets],
	);

	/*
	 * One click to the parallel grid. Each agent opens into the SAME tab, so
	 * they land side by side rather than as a row of tabs you then have to
	 * arrange — which is the whole point of asking for more than one.
	 */
	/*
	 * A tab with nothing in it but the question.
	 *
	 * One `launcher` pane, no data — the pane reads the workspace's presets from
	 * this page and fills the tab in by running the ordinary openers, so there
	 * is nothing per-instance to persist and a reloaded launcher is still a
	 * launcher.
	 */
	const addLauncherTab = useCallback(() => {
		store.getState().addTab({
			panes: [{ kind: "new-tab", data: {} as PaneViewerData }],
		});
	}, [store]);

	const launchAllAgents = useCallback(() => {
		for (const preset of emptyStateAgents) {
			void runPresetOrSession(preset, { target: "active-tab" });
		}
	}, [emptyStateAgents, runPresetOrSession]);

	/*
	 * Filled on every render, deliberately without `useMemo`: these callbacks
	 * change identity as their own dependencies change, and a stale entry here
	 * would launch the wrong preset. Writing during render is safe because
	 * nothing reads it until a pane renders.
	 */
	newTabActionsRef.current = {
		agents: emptyStateAgents,
		/*
		 * `active-pane`, not `active-tab`.
		 *
		 * The launcher is opened by the pane header's `+`, which has already split
		 * the layout to make room for it. `active-tab` is only a preference and
		 * the agent presets ship `executionMode: "new-tab"`, which overruled it —
		 * so picking Codex opened Codex in a NEW GROUP and left the freshly split
		 * pane empty, undoing the split that was the point of the gesture.
		 */
		onLaunchAgent: (preset) => {
			void runPresetOrSession(preset, { target: "active-pane" });
		},
		onLaunchAgentAs: (preset, mode) => {
			void launchAgentAs(preset, mode, { target: "active-pane" });
		},
		canOpenAsPane,
		onLaunchAll: launchAllAgents,
		onOpenTerminal: () => {
			void addTerminalTab();
		},
		onOpenBrowser: addBrowserTab,
		onOpenQuickOpen: handleQuickOpen,
		onOpenSessions: openClaudeSessions,
	};

	const workspaceRunButton = (
		<V2WorkspaceRunButton
			projectId={workspace.projectId}
			definition={workspaceRun.definition}
			isRunning={workspaceRun.isRunning}
			isPending={workspaceRun.isPending}
			canForceStop={workspaceRun.canForceStop}
			onToggle={workspaceRun.toggleWorkspaceRun}
			onForceStop={workspaceRun.forceStopWorkspaceRun}
		/>
	);

	const toolRegistry = useMemo<PaneRegistry<PaneViewerData>>(
		() => ({
			...paneRegistry,
			files: {
				getTitle: () => "Files",
				getTabIcon: () => <Folder className="size-4" />,
				hideMaximizeControl: true,
				renderPane: () => (
					<FilesTool
						workspaceId={workspaceId}
						onSelectFile={openFilePaneFromTreeClick}
						selectedFilePath={selectedFilePath}
						pendingReveal={pendingReveal}
						onSearch={handleQuickOpen}
					/>
				),
			},
			changes: {
				getTitle: () => "Changes",
				getTabIcon: () => <GitCompareArrows className="size-4" />,
				hideMaximizeControl: true,
				renderPane: () => (
					<ChangesTool
						workspaceId={workspaceId}
						selectedFilePath={selectedFilePath}
						onOpenFile={openFilePaneFromTreeClick}
						onSelectDiff={openDiffPane}
						onOpenComment={openCommentPane}
					/>
				),
			},
		}),
		[
			paneRegistry,
			workspaceId,
			openFilePaneFromTreeClick,
			selectedFilePath,
			pendingReveal,
			handleQuickOpen,
			openDiffPane,
			openCommentPane,
		],
	);
	const toolPaneActions = useMemo(
		() => [
			{
				key: "close",
				label: "Close tool pane",
				tooltip: "Close tool pane",
				icon: <X className="size-4" />,
				onClick: (
					ctx: import("@superset/panes").RendererContext<PaneViewerData>,
				) => ctx.actions.close(),
			},
		],
		[],
	);

	return (
		<FileDocumentStoreProvider>
			<WorkspaceGitStatusProvider
				workspaceId={workspaceId}
				store={store}
				sidebarOpen={sidebarOpen}
			>
				<div className="flex min-h-0 min-w-0 flex-1" style={paneChromeVars}>
					<WorkspaceToolPanels
						key={`${activeHostUrl ?? "local"}:${workspaceId}`}
						tools={tools}
						mainMinimum={mainPaneMinimum(mainLayout, paneGap / 2)}
						registry={toolRegistry}
						paneActions={toolPaneActions}
						contextMenuActions={defaultContextMenuActions}
						onResizing={onSidebarResizeDragging}
					>
						<div
							className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
							data-workspace-id={workspaceId}
							style={paneChromeVars}
						>
							<Workspace<PaneViewerData>
								isActive={toolState.focus === "main"}
								key={workspaceId}
								registry={paneRegistry}
								paneActions={defaultPaneActions}
								contextMenuActions={defaultContextMenuActions}
								renderTabIcon={renderBrowserTabIcon}
								renderTabAccessory={(tab) => (
									<V2NotificationStatusIndicator
										sources={getV2NotificationSourcesForTab(tab)}
									/>
								)}
								renderTabPaneList={(tab) => (
									<TabPaneList
										registry={paneRegistry}
										store={store}
										tab={tab}
									/>
								)}
								renderBelowTabBar={() =>
									showPresetsBar && !presetsInHeader ? (
										<V2PresetsBar
											matchedPresets={matchedPresets}
											executePreset={runPresetOrSession}
											showPresetsBar={showPresetsBar}
											onToggleShowPresetsBar={setShowPresetsBar}
											trailing={workspaceRunButton}
										/>
									) : null
								}
								/*
								 * `+` makes the tab NOW and lets the tab ask what it is.
								 *
								 * It used to open a dropdown, so creating a tab meant deciding
								 * what it would be before you had one, and changing your mind
								 * meant closing it and starting over.
								 *
								 * `AddTabMenu` is gone with it. Everything it offered is on the
								 * launcher — including Recent sessions, which lived nowhere
								 * else on the tab strip.
								 */
								onAddTab={addLauncherTab}
								renderEmptyState={() => (
									<WorkspaceEmptyState
										agents={emptyStateAgents}
										canOpenAsPane={canOpenAsPane}
										onLaunchAgent={(preset) => {
											void runPresetOrSession(preset);
										}}
										onLaunchAgentAs={(preset, mode) => {
											void launchAgentAs(preset, mode);
										}}
										onLaunchAll={launchAllAgents}
										onOpenBrowser={addBrowserTab}
										onOpenQuickOpen={handleQuickOpen}
										onOpenTerminal={addTerminalTab}
									/>
								)}
								showTabBar={tabStrip === "bar"}
								onBeforeCloseTab={onBeforeCloseTab}
								onInteractionStateChange={onWorkspaceInteractionStateChange}
								store={store}
							/>
						</div>
					</WorkspaceToolPanels>
				</div>
				{tabsSlotEl &&
					createPortal(
						<div
							className="contents"
							onPointerDownCapture={() => tools.focus("main")}
							onFocusCapture={() => tools.focus("main")}
						>
							<TabRail
								onCloseGroup={(tabId) => {
									void closeGroup(tabId);
								}}
								onNewGroup={addLauncherTab}
								registry={paneRegistry}
								store={store}
							/>
						</div>,
						tabsSlotEl,
					)}
				{shellsSlotEl &&
					createPortal(
						<BackgroundTerminalsButton
							store={store}
							workspaceId={workspaceId}
						/>,
						shellsSlotEl,
					)}
				{/*
				 * The run button needs the top bar whenever the presets row is not
				 * on screen — either hidden by preference, or moved into the header.
				 */}
				{showPresetsBar &&
					presetsInHeader &&
					presetsSlotEl &&
					createPortal(
						<V2PresetsBar
							executePreset={runPresetOrSession}
							matchedPresets={matchedPresets}
							onToggleShowPresetsBar={setShowPresetsBar}
							showPresetsBar={showPresetsBar}
							variant="header"
						/>,
						presetsSlotEl,
					)}
			</WorkspaceGitStatusProvider>
			<CommandPalette
				workspaceId={workspaceId}
				open={quickOpenOpen}
				onOpenChange={handleQuickOpenChange}
				onSelectFile={handleQuickOpenSelectFile}
				variant="v2"
				recentlyViewedFiles={recentFiles}
				openFilePaths={openFilePaths}
			/>
		</FileDocumentStoreProvider>
	);
}
