import type { WorkspaceStore } from "@superset/panes";
import { useCallback } from "react";
import type { V2TerminalPresetRow } from "renderer/routes/_authenticated/providers/CollectionsProvider/dashboardSidebarLocal";
import type { PresetLaunchOptions } from "renderer/stores/tabs/preset-launch";
import type { StoreApi } from "zustand/vanilla";
import type {
	BrowserPaneData,
	ClaudeSessionsPaneData,
	CommentPaneData,
	DiffFocusSide,
	DiffPaneData,
	PaneViewerData,
	SessionPaneData,
	TerminalPaneData,
} from "../../types";
import type { TerminalLauncher } from "../useV2TerminalLauncher";
import { placeLaunchedPanes } from "./place-launched-panes";

export function useWorkspacePaneOpeners({
	store,
	launcher,
	newTabPresets,
	executePreset,
}: {
	store: StoreApi<WorkspaceStore<PaneViewerData>>;
	launcher: TerminalLauncher;
	newTabPresets: V2TerminalPresetRow[];
	executePreset: (
		preset: V2TerminalPresetRow,
		options?: PresetLaunchOptions,
	) => void | Promise<void>;
}): {
	openDiffPane: (
		filePath: string,
		openInNewTab?: boolean,
		line?: number,
		side?: DiffFocusSide,
		changeKey?: string,
	) => void;
	addTerminalTab: (options?: PresetLaunchOptions) => Promise<void>;
	addBrowserTab: (options?: PresetLaunchOptions) => void;
	addSessionTab: (options?: {
		target?: PresetLaunchOptions["target"];
		paneTarget?: PresetLaunchOptions["paneTarget"];
		provider?: "claude" | "codex";
	}) => void;
	openBrowserUrl: (url: string) => void;
	openClaudeSessions: () => void;
	openCommentPane: (comment: CommentPaneData) => void;
} {
	const openDiffPane = useCallback(
		(
			filePath: string,
			openInNewTab?: boolean,
			line?: number,
			side?: DiffFocusSide,
			changeKey?: string,
		) => {
			const state = store.getState();
			// Bump tick on every request so the scroll effect re-fires on repeat
			// clicks; clear when no line is given so reused panes don't jump
			// to a stale focus.
			const focusFields =
				line != null
					? { focusLine: line, focusSide: side, focusTick: Date.now() }
					: {
							focusLine: undefined,
							focusSide: undefined,
							focusTick: undefined,
						};
			if (openInNewTab) {
				state.addTab({
					panes: [
						{
							kind: "diff",
							data: {
								path: filePath,
								changeKey,
								collapsedFiles: [],
								...focusFields,
							} as DiffPaneData,
						},
					],
				});
				return;
			}
			for (const tab of state.tabs) {
				for (const pane of Object.values(tab.panes)) {
					if (pane.kind !== "diff") continue;
					const prev = pane.data as DiffPaneData;
					state.setPaneData({
						paneId: pane.id,
						data: {
							...prev,
							path: filePath,
							changeKey,
							// Only the navigated file's key can be pruned; without a
							// change key we can't identify it, so leave the set intact.
							collapsedFiles: changeKey
								? (prev.collapsedFiles ?? []).filter((key) => key !== changeKey)
								: (prev.collapsedFiles ?? []),
							...focusFields,
						} as PaneViewerData,
					});
					state.setActiveTab(tab.id);
					state.setActivePane({ tabId: tab.id, paneId: pane.id });
					return;
				}
			}
			state.openPane({
				pane: {
					kind: "diff",
					data: {
						path: filePath,
						changeKey,
						collapsedFiles: [],
						...focusFields,
					} as DiffPaneData,
				},
			});
		},
		[store],
	);

	const addBlankTerminalTab = useCallback(
		async (options?: PresetLaunchOptions) => {
			const terminalId = await launcher.create();
			placeLaunchedPanes(
				store,
				[{ kind: "terminal", data: { terminalId } as TerminalPaneData }],
				options?.paneTarget,
			);
		},
		[store, launcher],
	);

	const addTerminalTab = useCallback(
		async (options?: PresetLaunchOptions) => {
			if (newTabPresets.length === 0) {
				await addBlankTerminalTab(options);
				return;
			}
			for (const preset of newTabPresets) {
				await executePreset(preset, options ?? { target: "new-tab" });
			}
		},
		[addBlankTerminalTab, executePreset, newTabPresets],
	);

	const addBrowserTab = useCallback(
		(options?: PresetLaunchOptions) => {
			placeLaunchedPanes(
				store,
				[{ kind: "browser", data: { url: "about:blank" } as BrowserPaneData }],
				options?.paneTarget,
			);
		},
		[store],
	);

	const addSessionTab = useCallback(
		(options?: PresetLaunchOptions & { provider?: "claude" | "codex" }) => {
			const state = store.getState();
			const pane = {
				kind: "session",
				data: { provider: options?.provider } as SessionPaneData,
			} as const;
			if (options?.target === "active-pane") {
				const active = state.getActivePane();
				placeLaunchedPanes(
					store,
					[pane],
					options.paneTarget ??
						(active
							? { tabId: active.tabId, paneId: active.pane.id }
							: undefined),
				);
			} else if (options?.target === "active-tab" && state.activeTabId) {
				state.addPane({ tabId: state.activeTabId, pane });
			} else {
				state.addTab({ panes: [pane] });
			}
		},
		[store],
	);

	// Open a specific URL in a browser tab. Reuses an existing browser pane
	// already showing this URL (focus it) rather than stacking duplicates —
	// repeated Preview clicks land on the same pane.
	const openBrowserUrl = useCallback(
		(url: string) => {
			const state = store.getState();
			for (const tab of state.tabs) {
				for (const pane of Object.values(tab.panes)) {
					if (pane.kind !== "browser") continue;
					const data = pane.data as BrowserPaneData;
					if (data.url !== url) continue;
					state.setActiveTab(tab.id);
					state.setActivePane({ tabId: tab.id, paneId: pane.id });
					return;
				}
			}
			state.addTab({
				panes: [
					{
						kind: "browser",
						data: { url } as BrowserPaneData,
					},
				],
			});
		},
		[store],
	);

	// Open the recent-sessions browser. If one is already open, focus it;
	// otherwise split it in beside the active pane.
	const openClaudeSessions = useCallback(() => {
		const state = store.getState();
		for (const tab of state.tabs) {
			for (const pane of Object.values(tab.panes)) {
				if (pane.kind !== "claude-sessions") continue;
				state.setActiveTab(tab.id);
				state.setActivePane({ tabId: tab.id, paneId: pane.id });
				return;
			}
		}
		state.openPane({
			pane: {
				kind: "claude-sessions",
				data: {} as ClaudeSessionsPaneData,
			},
		});
	}, [store]);

	const openCommentPane = useCallback(
		(comment: CommentPaneData) => {
			const state = store.getState();
			for (const tab of state.tabs) {
				for (const pane of Object.values(tab.panes)) {
					if (pane.kind !== "comment") continue;
					state.setPaneData({
						paneId: pane.id,
						data: comment as PaneViewerData,
					});
					state.setActiveTab(tab.id);
					state.setActivePane({ tabId: tab.id, paneId: pane.id });
					return;
				}
			}
			state.addTab({
				panes: [
					{
						kind: "comment",
						data: comment as PaneViewerData,
					},
				],
			});
		},
		[store],
	);

	return {
		openDiffPane,
		addTerminalTab,
		addBrowserTab,
		addSessionTab,
		openBrowserUrl,
		openClaudeSessions,
		openCommentPane,
	};
}
