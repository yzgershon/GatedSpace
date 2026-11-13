import { useQueryClient } from "@tanstack/react-query";
import {
	useCallback,
	useEffect,
	useMemo,
	useState,
	useSyncExternalStore,
} from "react";
import {
	deriveSessionPaneStatus,
	useSessionPaneStatuses,
} from "renderer/hooks/useSessionPaneStatuses";
import {
	getSessionActivity,
	getSessionActivityVersion,
	getSessionPaneIdsForWorkspace,
	getSessionWorkspaceEntries,
	subscribeSessionActivity,
} from "renderer/stores/session-activity";
import {
	getV2NotificationSourceKey,
	getV2NotificationSourcesForPane,
	useV2NotificationStore,
	type V2NotificationPaneLike,
	type V2NotificationSourceInput,
} from "renderer/stores/v2-notifications";
import {
	type ActivePaneStatus,
	getHighestPriorityStatus,
	type PaneStatus,
} from "shared/tabs-types";
import {
	type TerminalAgentBinding,
	useTerminalAgentBindings,
} from "../useTerminalAgentBindings";
import {
	deriveTerminalAgentStatus,
	useTerminalAgentStatuses,
} from "../useTerminalAgentStatuses";

const TERMINAL_PREFIX = "terminal:";
const SESSION_PREFIX = "session:";

function idsWithPrefix(
	sources: Iterable<V2NotificationSourceInput>,
	prefix: string,
): string[] {
	const ids: string[] = [];
	for (const key of new Set([...sources].map(getV2NotificationSourceKey))) {
		if (key.startsWith(prefix)) ids.push(key.slice(prefix.length));
	}
	return ids;
}

/**
 * Highest-priority status across a set of notification sources.
 *
 * Two kinds contribute, from two different sources of truth, because the two
 * kinds of agent report through different channels: a TERMINAL agent's status
 * comes from host agent bindings (hook events the CLI fires), while a SESSION
 * pane's comes from its own streamed transcript, mirrored into the renderer's
 * session-activity store. Chat sources are a v1 leftover and still contribute
 * nothing.
 */
export function useV2SourcesNotificationStatus(
	workspaceId: string,
	sources: Iterable<V2NotificationSourceInput>,
): ActivePaneStatus | null {
	const terminalStatuses = useTerminalAgentStatuses(workspaceId);
	const sourceList = [...sources];
	const sessionStatuses = useSessionPaneStatuses(
		idsWithPrefix(sourceList, SESSION_PREFIX),
	);
	return getHighestPriorityStatus([
		...idsWithPrefix(sourceList, TERMINAL_PREFIX).map((terminalId) =>
			terminalStatuses.get(terminalId),
		),
		...sessionStatuses.values(),
	]);
}

export function useV2PaneNotificationStatus(
	workspaceId: string,
	pane: V2NotificationPaneLike | null | undefined,
): ActivePaneStatus | null {
	return useV2SourcesNotificationStatus(
		workspaceId,
		getV2NotificationSourcesForPane(pane),
	);
}

/**
 * Every session pane belonging to a workspace, as a status lookup. Reads
 * through the same store the tab dots use, so a workspace row and its tabs can
 * never disagree about whether an agent is done.
 *
 * `getSessionPaneIdsForWorkspace` is read during render without its own
 * subscription because `useSessionPaneStatuses` already subscribes to the same
 * store — a registration bumps the same version a status change does, so the
 * re-render that refreshes the statuses refreshes this list with it.
 */
function useWorkspaceSessionStatuses(
	workspaceId: string,
): Map<string, PaneStatus> {
	return useSessionPaneStatuses(getSessionPaneIdsForWorkspace(workspaceId));
}

export function useV2WorkspaceNotificationStatus(
	workspaceId: string,
): ActivePaneStatus | null {
	const statuses = useTerminalAgentStatuses(workspaceId);
	const sessionStatuses = useWorkspaceSessionStatuses(workspaceId);
	const manualUnread = useV2NotificationStore((state) =>
		Boolean(state.manualUnread[workspaceId]),
	);
	return getHighestPriorityStatus([
		manualUnread ? "review" : undefined,
		...statuses.values(),
		...sessionStatuses.values(),
	]);
}

export function useV2WorkspaceIsUnread(workspaceId: string): boolean {
	const statuses = useTerminalAgentStatuses(workspaceId);
	const sessionStatuses = useWorkspaceSessionStatuses(workspaceId);
	const manualUnread = useV2NotificationStore((state) =>
		Boolean(state.manualUnread[workspaceId]),
	);
	if (manualUnread) return true;
	for (const status of statuses.values()) {
		if (status === "review") return true;
	}
	// `error` counts as unread here as well as `review`: both mean a turn ended
	// and nobody has looked at it, which is exactly what unread describes.
	for (const status of sessionStatuses.values()) {
		if (status === "review" || status === "error") return true;
	}
	return false;
}

/**
 * Returns a callback that marks every terminal with a live agent binding in
 * the workspace as seen, clearing derived `review` statuses. Used by the
 * sidebar "mark read" / "clear status" actions.
 */
export function useMarkWorkspaceTerminalsSeen(workspaceId: string): () => void {
	const bindings = useTerminalAgentBindings(workspaceId);
	const markTerminalSeen = useV2NotificationStore(
		(state) => state.markTerminalSeen,
	);
	return useCallback(() => {
		// Host-clock only: "seen through the binding's last event".
		for (const binding of bindings.values()) {
			markTerminalSeen(binding.terminalId, binding.lastEventAt);
		}
	}, [bindings, markTerminalSeen]);
}

/**
 * Number of distinct workspaces needing attention (any derived terminal
 * status other than `working`, or a manual unread mark). Drives the OS dock
 * badge. Aggregates over the bindings queries already mounted by sidebar
 * rows via the react-query cache; workspaces with no observed bindings
 * query contribute only their manual unread mark.
 */
export function useV2AttentionWorkspaceCount(): number {
	const queryClient = useQueryClient();
	const manualUnread = useV2NotificationStore((state) => state.manualUnread);
	const terminalSeenAt = useV2NotificationStore(
		(state) => state.terminalSeenAt,
	);
	const sessionSeenTurn = useV2NotificationStore(
		(state) => state.sessionSeenTurn,
	);
	const activityVersion = useSyncExternalStore(
		subscribeSessionActivity,
		getSessionActivityVersion,
	);
	const [cacheVersion, setCacheVersion] = useState(0);

	useEffect(() => {
		return queryClient.getQueryCache().subscribe((event) => {
			if (event.query.queryKey[0] === "terminal-agent-bindings") {
				setCacheVersion((version) => version + 1);
			}
		});
	}, [queryClient]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: cacheVersion re-reads the query cache, activityVersion re-reads the session-activity store
	return useMemo(() => {
		const workspaceIds = new Set(Object.keys(manualUnread));
		// Session panes report through their own store rather than through the
		// bindings query — a session pane runs the CLI in stream-json mode and
		// never registers a terminal agent binding, so without this loop a
		// workspace whose only agent is a session pane never badges at all.
		for (const [paneId, workspaceId] of getSessionWorkspaceEntries()) {
			const status = deriveSessionPaneStatus({
				activity: getSessionActivity(paneId),
				seenTurn: sessionSeenTurn[paneId],
			});
			if (status === "review" || status === "error") {
				workspaceIds.add(workspaceId);
			}
		}
		const entries = queryClient.getQueriesData<TerminalAgentBinding[]>({
			queryKey: ["terminal-agent-bindings"],
		});
		for (const [, bindings] of entries) {
			for (const binding of bindings ?? []) {
				const status = deriveTerminalAgentStatus({
					lastEventType: binding.lastEventType,
					lastEventAt: binding.lastEventAt,
					lastSeenAt: terminalSeenAt[binding.terminalId],
				});
				if (status === "permission" || status === "review") {
					workspaceIds.add(binding.workspaceId);
				}
			}
		}
		return workspaceIds.size;
	}, [
		cacheVersion,
		activityVersion,
		manualUnread,
		terminalSeenAt,
		sessionSeenTurn,
		queryClient,
	]);
}
