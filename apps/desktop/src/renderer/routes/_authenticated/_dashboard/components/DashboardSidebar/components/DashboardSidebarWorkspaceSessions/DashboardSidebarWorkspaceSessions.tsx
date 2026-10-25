import { cn } from "@superset/ui/utils";
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
	type WorkspaceSession,
} from "renderer/stores/workspace-groups";
import type { PaneStatus } from "shared/tabs-types";

const STATUS_LABELS: Record<PaneStatus, string> = {
	idle: "Idle",
	working: "Working",
	permission: "Needs your reply",
	review: "Complete",
	error: "Needs attention",
};

function SessionRow({
	session,
	status,
	position,
}: {
	session: WorkspaceSession;
	status: PaneStatus;
	position: number;
}) {
	const { paneId, provider, title: savedTitle } = session;
	const icon = usePresetIcon(provider);
	const requestFocus = useFocusPaneIntent((state) => state.request);
	const title = useSyncExternalStore(
		useCallback(
			(callback) =>
				provider === "codex"
					? subscribeCodexSession(paneId, callback)
					: subscribeSession(paneId, callback),
			[paneId, provider],
		),
		useCallback(() => {
			if (savedTitle) return savedTitle;
			if (provider === "claude") return getSessionTitle(paneId) ?? "";
			const nativeTitle = getCodexSession(paneId)?.title?.trim();
			// A new Codex session's transport title is just the provider name.
			return nativeTitle === "Codex" ? "" : (nativeTitle ?? "");
		}, [paneId, provider, savedTitle]),
	);
	const rateLimited = provider === "claude" && isSessionRateLimited(paneId);
	const providerName = provider === "codex" ? "Codex" : "Claude Code";
	const statusLabel = rateLimited
		? "Usage limit reached"
		: STATUS_LABELS[status];
	const description = [
		providerName,
		title || `Session ${position}`,
		statusLabel,
	].join(" · ");
	return (
		<button
			type="button"
			onClick={() => requestFocus(paneId)}
			aria-label={description}
			title={description}
			className={cn(
				"flex h-7 min-w-0 items-center gap-2 rounded-md px-2 text-[12.5px] text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring motion-reduce:transition-none",
				title ? "w-full" : "shrink-0",
			)}
		>
			<img
				src={icon}
				alt=""
				className="size-4 shrink-0 object-contain"
				draggable={false}
			/>
			{title && (
				<span className="min-w-0 flex-1 truncate text-left">{title}</span>
			)}
			<span
				aria-hidden="true"
				className={cn(
					"size-1.5 shrink-0 rounded-full",
					rateLimited || status === "error" || status === "permission"
						? "bg-destructive"
						: status === "working"
							? "animate-pulse bg-warning motion-reduce:animate-none"
							: "bg-success",
				)}
			/>
		</button>
	);
}

/** Session identity comes from the saved pane layout, activity from the transport. */
export function DashboardSidebarWorkspaceSessions({
	workspaceId,
}: {
	workspaceId: string;
}) {
	useSyncExternalStore(subscribeWorkspaceGroups, getWorkspaceGroupsVersion);
	const groups = getWorkspaceGroups(workspaceId).filter(
		(group) => group.sessions.length > 0,
	);
	const statuses = useSessionPaneStatuses(
		groups.flatMap((group) => group.sessions.map((session) => session.paneId)),
	);
	if (!groups.length) return null;
	const showGroupHeaders = groups.length > 1;

	return (
		<div className="flex flex-col gap-1 pb-1">
			{groups.map((group) => (
				<div className="min-w-0" key={group.id}>
					{showGroupHeaders && (
						<div
							className={cn(
								"flex h-6 items-center gap-1.5 pr-2.5 pl-[30px] text-[11px] text-muted-foreground",
								group.isActive && "text-foreground/80",
							)}
							title={group.title}
						>
							<span className="min-w-0 truncate">{group.title}</span>
							{group.sessions.length > 1 && (
								<span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
									{group.sessions.length}
								</span>
							)}
						</div>
					)}
					<div
						className={cn(
							"flex min-w-0 flex-wrap gap-0.5 pr-2",
							showGroupHeaders ? "pl-[34px]" : "pl-[22px]",
						)}
					>
						{group.sessions.map((session, index) => (
							<SessionRow
								key={session.paneId}
								session={session}
								status={statuses.get(session.paneId) ?? "idle"}
								position={index + 1}
							/>
						))}
					</div>
				</div>
			))}
		</div>
	);
}
