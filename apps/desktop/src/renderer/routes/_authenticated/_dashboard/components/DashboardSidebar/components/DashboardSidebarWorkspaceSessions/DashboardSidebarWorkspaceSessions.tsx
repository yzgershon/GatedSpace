/**
 * A workspace's live sessions, listed under its row and nested under the GROUP
 * each one is in.
 *
 * This is the half of the reference's sidebar GatedSpace has never had: the
 * tree stopped at the workspace, so with four agents running it could tell you
 * a workspace was busy but not WHO was busy, and reaching one meant opening the
 * workspace and hunting the tab strip.
 *
 * The group level matters more now than it did, because the tab strip is gone
 * under this skin — the sidebar IS where you see the shape of what is open, and
 * a flat list of six sessions with no indication of which three share a screen
 * is a worse answer than the strip gave. A workspace with exactly one group
 * skips the header rather than indenting everything under a heading that says
 * nothing.
 *
 * Each session row is the LAST PROMPT sent to that pane, not a derived title.
 * A title is taken from the first prompt and deliberately never changes, which
 * is right for a group label and wrong here — the question this list answers is
 * "what is each of these doing right now".
 *
 * Reads `workspace-groups` and `session-activity`, NOT the pane layout. The v2
 * pane store is created per route by `useV2WorkspacePaneLayout`; calling that
 * from the sidebar would build a SECOND, empty store rather than read the live
 * one. Both stores are module-level registries the workspace page publishes
 * into, which is exactly the question being asked.
 *
 * A pane only registers once it has MOUNTED, so this lists the workspace you
 * are in and stays empty for the rest. That is honest rather than unfortunate:
 * titles and statuses do not exist for a workspace you have not opened, so the
 * alternative is a column of rows all reading "Claude" with no dot — the same
 * trap `countWorkspacePanes` documents for the pane badge.
 */
import { cn } from "@superset/ui/utils";
import { useSyncExternalStore } from "react";
import { useSessionPaneStatuses } from "renderer/hooks/useSessionPaneStatuses";
import {
	getSessionLastPrompt,
	getSessionTitle,
	isSessionRateLimited,
	subscribeSession,
} from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/ClaudeSessionPane";
import { useFocusPaneIntent } from "renderer/stores/focus-pane-intent";
import {
	getSessionActivityVersion,
	getSessionPaneIdsForWorkspace,
	subscribeSessionActivity,
} from "renderer/stores/session-activity";
import {
	getWorkspaceGroups,
	getWorkspaceGroupsVersion,
	subscribeWorkspaceGroups,
} from "renderer/stores/workspace-groups";
import type { PaneStatus } from "shared/tabs-types";

/**
 * Green unless something is happening.
 *
 * The tab dots answer "does anything want me", so their resting state is
 * nothing at all. This list answers "which of these is healthy", so its resting
 * state is GREEN — a column of grey dots reads as a column of dead sessions,
 * which is exactly how it looked. Amber only while a turn runs, red only when
 * it failed or the account is out of window.
 */
function rowTone(
	status: PaneStatus,
	rateLimited: boolean,
): "ok" | "working" | "error" {
	if (rateLimited) return "error";
	if (status === "working") return "working";
	if (status === "error" || status === "permission") return "error";
	return "ok";
}

/** One session's last prompt, live. */
function SessionRowLabel({ paneId }: { paneId: string }) {
	const label = useSyncExternalStore(
		(callback) => subscribeSession(paneId, callback),
		// Falls back to the title, then to the agent's name: a pane that has been
		// opened but never prompted has no last prompt, and an empty row is worse
		// than a generic one.
		() => getSessionLastPrompt(paneId) ?? getSessionTitle(paneId) ?? "Claude",
	);
	return <span className="min-w-0 flex-1 truncate text-left">{label}</span>;
}

function SessionRow({
	paneId,
	tone,
	indent,
}: {
	paneId: string;
	tone: "ok" | "working" | "error";
	indent: number;
}) {
	const requestFocus = useFocusPaneIntent((state) => state.request);
	return (
		<button
			type="button"
			onClick={() => requestFocus(paneId)}
			style={{ paddingLeft: `${indent}px` }}
			className="flex h-7 w-full items-center gap-2.5 rounded-[8px] py-0 pr-2.5 text-[12.5px] text-muted-foreground/70 transition-colors hover:bg-sidebar-accent/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
		>
			<span
				aria-hidden="true"
				className={cn(
					"size-[7px] shrink-0 rounded-full",
					tone === "working" && "animate-pulse bg-warning",
					tone === "error" && "bg-destructive",
					tone === "ok" && "bg-success",
				)}
			/>
			<SessionRowLabel paneId={paneId} />
		</button>
	);
}

export function DashboardSidebarWorkspaceSessions({
	workspaceId,
}: {
	workspaceId: string;
}) {
	// Both subscribed by VERSION, so the snapshots stay primitives React can
	// compare — the same reason `useSessionPaneStatus` does it this way.
	useSyncExternalStore(subscribeSessionActivity, getSessionActivityVersion);
	useSyncExternalStore(subscribeWorkspaceGroups, getWorkspaceGroupsVersion);
	const paneIds = getSessionPaneIdsForWorkspace(workspaceId);
	const statuses = useSessionPaneStatuses(paneIds);
	const groups = getWorkspaceGroups(workspaceId);

	if (paneIds.length === 0) return null;

	const sessionPaneIds = new Set(paneIds);
	/*
	 * Groups that actually hold a session, with only their session panes.
	 *
	 * A group's pane list includes terminals, browsers and file views, and none
	 * of those have a last prompt or a status to report — listing them would
	 * turn a "what is running" list into an inventory of everything open.
	 */
	const groupsWithSessions = groups
		.map((group) => ({
			...group,
			paneIds: group.paneIds.filter((paneId) => sessionPaneIds.has(paneId)),
		}))
		.filter((group) => group.paneIds.length > 0);

	/*
	 * Sessions the group tree does not account for, listed flat at the end.
	 *
	 * Normally empty. It covers the tick between a pane registering itself and
	 * the page publishing the layout that contains it — dropping those rows for
	 * a frame would make a new session flicker into the sidebar rather than
	 * appear in it.
	 */
	const grouped = new Set(groupsWithSessions.flatMap((group) => group.paneIds));
	const ungrouped = paneIds.filter((paneId) => !grouped.has(paneId));

	const renderRow = (paneId: string, indent: number) => (
		<SessionRow
			indent={indent}
			key={paneId}
			paneId={paneId}
			tone={rowTone(
				statuses.get(paneId) ?? "idle",
				isSessionRateLimited(paneId),
			)}
		/>
	);

	// One group is not a grouping. Skipping the header keeps the common case
	// exactly as flat as it was before groups were nested at all.
	const showGroupHeaders = groupsWithSessions.length > 1;

	return (
		<div className="flex flex-col gap-px pb-1">
			{groupsWithSessions.map((group) =>
				showGroupHeaders ? (
					<div className="flex flex-col gap-px" key={group.id}>
						<div
							className={cn(
								"flex h-6 items-center gap-1.5 truncate pr-2.5 pl-[30px] text-[11px] text-muted-foreground/45",
								group.isActive && "text-muted-foreground/70",
							)}
							title={group.title}
						>
							<span className="min-w-0 truncate">{group.title}</span>
							{group.paneIds.length > 1 ? (
								<span className="shrink-0 text-[10px] text-muted-foreground/40">
									{group.paneIds.length}
								</span>
							) : null}
						</div>
						{group.paneIds.map((paneId) => renderRow(paneId, 42))}
					</div>
				) : (
					<div className="flex flex-col gap-px" key={group.id}>
						{group.paneIds.map((paneId) => renderRow(paneId, 30))}
					</div>
				),
			)}
			{ungrouped.map((paneId) => renderRow(paneId, showGroupHeaders ? 42 : 30))}
		</div>
	);
}
