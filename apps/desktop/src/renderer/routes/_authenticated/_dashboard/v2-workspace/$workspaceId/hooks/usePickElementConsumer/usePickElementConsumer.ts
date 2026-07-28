/**
 * Runs the element picker in a browser pane and drops the result into a Claude
 * session's composer.
 *
 * Lives here for the same reason the page-capture consumer does: it needs the
 * workspace store to find a session pane, and the browser pane's menu only
 * knows its own id.
 *
 * The target is resolved BEFORE the picker starts. Picking an element takes
 * several seconds of hovering, and discovering "nowhere to send it" at the end
 * of that would waste the whole interaction — and, worse, the pane the user
 * clicked into during the pick could change which session is focused.
 */
import type { Pane, WorkspaceStore } from "@superset/panes";
import { toast } from "@superset/ui/sonner";
import { useEffect, useRef } from "react";
import { electronTrpcClient } from "renderer/lib/trpc-client";
import { usePickElementIntent } from "renderer/stores/pick-element-intent";
import { formatPickedElement, type PickedElement } from "shared/element-picker";
import type { StoreApi } from "zustand/vanilla";
import type { PaneViewerData } from "../../types";
import { ELEMENT_PICKER_SCRIPT } from "../usePaneRegistry/components/BrowserPane/element-picker-script";
import { appendSessionDraftText } from "../usePaneRegistry/components/ClaudeSessionPane";
import {
	resolveTarget,
	type SessionPaneCandidates,
	targetErrorMessage,
} from "../useSendPageToSessionConsumer/resolve-target";

interface UsePickElementConsumerInput {
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

/**
 * The script resolves with either a payload or null (Escape / a non-element
 * click), and it comes back across an IPC boundary as `unknown`. Checked rather
 * than cast: a malformed payload should be a quiet no-op, not a crash in a
 * toast handler.
 */
function isPickedElement(value: unknown): value is PickedElement {
	if (!value || typeof value !== "object") return false;
	const candidate = value as Partial<PickedElement>;
	return Array.isArray(candidate.chain) && typeof candidate.html === "string";
}

export function usePickElementConsumer({
	store,
}: UsePickElementConsumerInput): void {
	const tick = usePickElementIntent((state) => state.tick);
	// Ignore the tick this hook mounts on, or remounting the workspace would
	// replay the last pick.
	const lastHandledTick = useRef(tick);

	useEffect(() => {
		if (tick === lastHandledTick.current) return;
		lastHandledTick.current = tick;

		const { browserPaneId, clear } = usePickElementIntent.getState();
		if (!browserPaneId) return;
		clear();

		const target = resolveTarget(collectSessionPanes(store.getState()));
		if ("error" in target) {
			toast.error("Nowhere to send it", {
				description: targetErrorMessage(target.error),
			});
			return;
		}

		toast.info("Click an element", { description: "Escape to cancel." });

		void electronTrpcClient.browser.evaluateJS
			.mutate({ paneId: browserPaneId, code: ELEMENT_PICKER_SCRIPT })
			.then(({ result }) => {
				// The router wraps the script's value as `{ result }`, and the script
				// resolves null on Escape. Destructure rather than fall back to the
				// wrapper: `payload ?? result` would hand the WRAPPER object on to the
				// check below and report "couldn't read that element" on every cancel.
				if (result === null || result === undefined) return;
				if (!isPickedElement(result)) {
					toast.error("Couldn't read that element");
					return;
				}
				appendSessionDraftText(target.paneId, formatPickedElement(result));
				toast.success("Element added to the session");
			})
			.catch((error: unknown) => {
				const description =
					error instanceof Error ? error.message : "Unknown error";
				toast.error("Couldn't pick an element", { description });
			});
	}, [tick, store]);
}
