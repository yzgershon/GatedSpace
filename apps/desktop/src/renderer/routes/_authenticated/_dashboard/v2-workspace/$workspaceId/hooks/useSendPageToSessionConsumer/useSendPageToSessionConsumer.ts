/**
 * Captures a browser pane and attaches the image to a Claude session's
 * composer.
 *
 * Lives here because it needs the workspace store to find a session pane; the
 * browser pane's menu only knows its own id.
 *
 * It ATTACHES rather than sends. A screenshot on its own is not a question, and
 * guessing the question — "what do you see?" — would be wrong most of the time.
 * The image lands in the composer with the caret ready, which is also what
 * pasting one does, so the two routes behave identically.
 */
import type { Pane, WorkspaceStore } from "@superset/panes";
import { toast } from "@superset/ui/sonner";
import { useEffect, useRef } from "react";
import { electronTrpcClient } from "renderer/lib/trpc-client";
import { useSendPageToSessionIntent } from "renderer/stores/send-page-to-session-intent";
import type { StoreApi } from "zustand/vanilla";
import type { PaneViewerData } from "../../types";
import { attachSessionDraftImage } from "../usePaneRegistry/components/ClaudeSessionPane";
import { prepareImageFromBase64 } from "../usePaneRegistry/components/ClaudeSessionPane/composer-images";
import {
	resolveTarget,
	type SessionPaneCandidates,
	targetErrorMessage,
} from "./resolve-target";

interface UseSendPageToSessionConsumerInput {
	store: StoreApi<WorkspaceStore<PaneViewerData>>;
}

function isSessionPane(pane: Pane<PaneViewerData> | null | undefined): boolean {
	return pane?.kind === "session";
}

function collectSessionPanes(
	state: WorkspaceStore<PaneViewerData>,
): SessionPaneCandidates {
	const active = state.getActivePane();
	const all: string[] = [];
	for (const tab of state.tabs) {
		for (const pane of Object.values(tab.panes)) {
			const candidate = pane as Pane<PaneViewerData>;
			if (isSessionPane(candidate)) all.push(candidate.id);
		}
	}
	return {
		activeSessionPaneId:
			active && isSessionPane(active.pane) ? active.pane.id : undefined,
		allSessionPaneIds: all,
	};
}

export function useSendPageToSessionConsumer({
	store,
}: UseSendPageToSessionConsumerInput): void {
	const tick = useSendPageToSessionIntent((state) => state.tick);
	// Ignore the tick this hook mounts on, or remounting the workspace would
	// replay the last capture into whatever session is focused now.
	const lastHandledTick = useRef(tick);

	useEffect(() => {
		if (tick === lastHandledTick.current) return;
		lastHandledTick.current = tick;

		const { browserPaneId, clear } = useSendPageToSessionIntent.getState();
		if (!browserPaneId) return;
		clear();

		const target = resolveTarget(collectSessionPanes(store.getState()));
		if ("error" in target) {
			toast.error("Nowhere to send it", {
				description: targetErrorMessage(target.error),
			});
			return;
		}

		void electronTrpcClient.browser.screenshot
			.mutate({ paneId: browserPaneId })
			.then(({ base64 }) =>
				prepareImageFromBase64(base64, "page.png").then((image) => {
					attachSessionDraftImage(target.paneId, image);
					toast.success("Page attached to the session");
				}),
			)
			.catch((error: unknown) => {
				const description =
					error instanceof Error ? error.message : "Unknown error";
				toast.error("Couldn't capture the page", { description });
			});
	}, [tick, store]);
}
