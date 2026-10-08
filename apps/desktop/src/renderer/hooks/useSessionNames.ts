import type { WorkspaceStore } from "@superset/panes";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { applySessionNames } from "renderer/lib/session-names";
import { electronTrpcClient } from "renderer/lib/trpc-client";
import type { PaneViewerData } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/types";
import type { SessionNamesSnapshot } from "shared/session-names";
import type { StoreApi } from "zustand/vanilla";

export function useSessionNames(
	store: StoreApi<WorkspaceStore<PaneViewerData>>,
) {
	const queryClient = useQueryClient();
	useEffect(() => {
		let snapshot: SessionNamesSnapshot | undefined;
		let applying = false;
		let queued = false;
		let stopped = false;
		const apply = (next: SessionNamesSnapshot) => {
			if (applying) return;
			applying = true;
			try {
				applySessionNames(store, next, snapshot);
			} finally {
				applying = false;
				snapshot = next;
			}
		};
		const sub = electronTrpcClient.sessionNames.watch.subscribe(undefined, {
			onData(next) {
				apply(next);
				void queryClient.invalidateQueries({
					queryKey: ["sidebar-agent-sessions"],
				});
				void queryClient.invalidateQueries({ queryKey: ["agent-sessions"] });
			},
			onError(error) {
				console.warn("[session-names] subscription failed", error);
			},
		});
		const unsubscribe = store.subscribe(() => {
			if (queued || applying || !snapshot) return;
			queued = true;
			// Finish layout persistence before applying names to a restored layout.
			queueMicrotask(() => {
				queued = false;
				if (!stopped && snapshot) apply(snapshot);
			});
		});
		return () => {
			stopped = true;
			sub.unsubscribe();
			unsubscribe();
		};
	}, [store, queryClient]);
}
