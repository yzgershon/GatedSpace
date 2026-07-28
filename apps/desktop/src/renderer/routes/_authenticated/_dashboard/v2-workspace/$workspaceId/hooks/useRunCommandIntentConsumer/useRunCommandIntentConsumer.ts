/**
 * Delivers a command the palette asked to run into the focused terminal.
 *
 * The palette is mounted app-wide and cannot reach the workspace's pane store,
 * which arrives here as a prop. This hook is the workspace-side half: it lives
 * where `store` exists, watches the intent, and writes.
 *
 * It writes WITHOUT a trailing newline on purpose. The command lands at the
 * prompt with the cursor after it, ready to edit or submit. Executing straight
 * from a fuzzy-matched history list is how someone runs last week's `rm` in
 * this week's directory.
 */
import type { Pane, WorkspaceStore } from "@superset/panes";
import { toast } from "@superset/ui/sonner";
import { workspaceTrpc } from "@superset/workspace-client";
import { useEffect, useRef } from "react";
import { useRunCommandIntent } from "renderer/stores/run-command-intent";
import type { StoreApi } from "zustand/vanilla";
import type { PaneViewerData, TerminalPaneData } from "../../types";

interface UseRunCommandIntentConsumerInput {
	store: StoreApi<WorkspaceStore<PaneViewerData>>;
	workspaceId: string;
}

function isTerminalPane(
	pane: Pane<PaneViewerData> | null | undefined,
): pane is Pane<TerminalPaneData> {
	return pane?.kind === "terminal";
}

export function useRunCommandIntentConsumer({
	store,
	workspaceId,
}: UseRunCommandIntentConsumerInput): void {
	const writeInput = workspaceTrpc.terminal.writeInput.useMutation();
	const tick = useRunCommandIntent((state) => state.tick);
	// Ignore the tick this hook mounts on. Without it, remounting the workspace
	// (a tab switch, a route change) would replay whatever command was last
	// asked for, into whatever terminal happens to be focused now.
	const lastHandledTick = useRef(tick);

	useEffect(() => {
		if (tick === lastHandledTick.current) return;
		lastHandledTick.current = tick;

		const { command, clear } = useRunCommandIntent.getState();
		if (!command) return;
		clear();

		const active = store.getState().getActivePane();
		if (!isTerminalPane(active?.pane)) {
			toast.error("No terminal focused", {
				description: "Open or click a terminal, then try again.",
			});
			return;
		}

		writeInput
			.mutateAsync({
				workspaceId,
				terminalId: active.pane.data.terminalId,
				data: command,
			})
			.catch((error: unknown) => {
				const message =
					error instanceof Error ? error.message : "Unknown error";
				toast.error("Couldn't write to the terminal", {
					description: message,
				});
			});
	}, [tick, store, workspaceId, writeInput]);
}
