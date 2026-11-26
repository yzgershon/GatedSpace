import { useCallback, useSyncExternalStore } from "react";
import { usePresetIcon } from "renderer/assets/app-icons/preset-icons";
import { useSessionPaneStatuses } from "renderer/hooks/useSessionPaneStatuses";
import {
	getCodexSession,
	subscribeCodexSession,
} from "renderer/lib/codex-session/store";
import {
	getSessionTitle,
	isSessionRateLimited,
	subscribeSession,
} from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/ClaudeSessionPane/sessionStore";
import { useFocusPaneIntent } from "renderer/stores/focus-pane-intent";
import {
	getWorkspaceGroups,
	getWorkspaceGroupsVersion,
	subscribeWorkspaceGroups,
} from "renderer/stores/workspace-groups";
import { useWorkspaceRecency } from "renderer/stores/workspace-recency";
import type { PaneStatus } from "shared/tabs-types";
import { CompactSessionRows } from "./CompactSessionRows";

const STATUS_LABELS: Record<PaneStatus, string> = {
	idle: "Idle",
	working: "Working",
	permission: "Needs your reply",
	review: "Complete",
	error: "Needs attention",
};

export function CompactWorkspaceSessions({
	workspaceId,
}: {
	workspaceId: string;
}) {
	useSyncExternalStore(subscribeWorkspaceGroups, getWorkspaceGroupsVersion);
	const groups = getWorkspaceGroups(workspaceId);
	const statuses = useSessionPaneStatuses(
		groups.flatMap((group) => group.sessions.map((session) => session.paneId)),
	);
	const sessions = groups.flatMap((group) => group.sessions);
	const metadata = JSON.parse(
		useSyncExternalStore(
			useCallback(
				(notify) => {
					const unsubscribe = groups.flatMap((group) =>
						group.sessions.map((session) =>
							(session.provider === "codex"
								? subscribeCodexSession
								: subscribeSession)(session.paneId, notify),
						),
					);
					return () => {
						for (const off of unsubscribe) off();
					};
				},
				[groups],
			),
			useCallback(
				() =>
					JSON.stringify(
						groups.flatMap((group) =>
							group.sessions.map((session) => ({
								title:
									session.title ||
									(session.provider === "codex"
										? getCodexSession(session.paneId)?.title
										: getSessionTitle(session.paneId)) ||
									"",
								limited:
									session.provider === "claude" &&
									isSessionRateLimited(session.paneId),
							})),
						),
					),
				[groups],
			),
		),
	) as { title: string; limited: boolean }[];
	const metadataById = new Map(
		sessions.map((session, index) => [session.paneId, metadata[index]]),
	);
	const codexIcon = usePresetIcon("codex");
	const claudeIcon = usePresetIcon("claude");
	const requestFocus = useFocusPaneIntent((state) => state.request);
	return (
		<CompactSessionRows
			groups={groups.map((group) => ({
				...group,
				sessions: group.sessions.map((session, index) => {
					const live = metadataById.get(session.paneId);
					const status = live?.limited
						? "error"
						: (statuses.get(session.paneId) ?? "idle");
					return {
						id: session.paneId,
						title:
							live?.title ||
							(group.sessions.length === 1
								? group.title
								: `${session.provider === "codex" ? "Codex" : "Claude"} ${index + 1}`),
						icon: session.provider === "codex" ? codexIcon : claudeIcon,
						status,
						statusLabel: live?.limited
							? "Usage limit reached"
							: STATUS_LABELS[status],
					};
				}),
			}))}
			onSelect={(paneId) => {
				useWorkspaceRecency.getState().markOpened(workspaceId);
				requestFocus(paneId);
			}}
		/>
	);
}
