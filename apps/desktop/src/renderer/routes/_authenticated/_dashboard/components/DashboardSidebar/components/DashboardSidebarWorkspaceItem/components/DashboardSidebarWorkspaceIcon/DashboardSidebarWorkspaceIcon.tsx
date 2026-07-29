import { cn } from "@superset/ui/utils";
import {
	LuGitBranch,
	LuGitMerge,
	LuGitPullRequest,
	LuGitPullRequestClosed,
	LuGitPullRequestDraft,
	LuListChecks,
	LuSquareTerminal,
} from "react-icons/lu";
import { TbCloud, TbCloudOff } from "react-icons/tb";
import { AsciiSpinner } from "renderer/components/AsciiSpinner";
import { StatusIndicator } from "renderer/components/StatusIndicator";
import type { ActivePaneStatus } from "shared/tabs-types";
import type {
	DashboardSidebarWorkspaceHostType,
	DashboardSidebarWorkspacePullRequest,
	DashboardSidebarWorkspaceType,
} from "../../../../types";

interface DashboardSidebarWorkspaceIconProps {
	hostType: DashboardSidebarWorkspaceHostType;
	workspaceType: DashboardSidebarWorkspaceType;
	hostIsOnline: boolean | null;
	isActive: boolean;
	variant: "collapsed" | "expanded";
	workspaceStatus?: ActivePaneStatus | null;
	isCreatePending: boolean;
	pullRequestState?: DashboardSidebarWorkspacePullRequest["state"] | null;
}

const OVERLAY_POSITION = {
	collapsed: "top-1 right-1",
	expanded: "-top-0.5 -right-0.5",
} as const;

const PR_ICON_BY_STATE = {
	open: LuGitPullRequest,
	merged: LuGitMerge,
	closed: LuGitPullRequestClosed,
	draft: LuGitPullRequestDraft,
	queued: LuListChecks,
} as const;

const PR_COLOR_BY_STATE = {
	open: "text-emerald-500",
	merged: "text-purple-500",
	closed: "text-destructive",
	draft: "text-muted-foreground",
	queued: "text-amber-500",
} as const;

export function DashboardSidebarWorkspaceIcon({
	hostType,
	workspaceType,
	hostIsOnline,
	isActive,
	variant,
	workspaceStatus = null,
	isCreatePending,
	pullRequestState = null,
}: DashboardSidebarWorkspaceIconProps) {
	const overlayPosition = OVERLAY_POSITION[variant];
	const iconColor = isActive ? "text-foreground" : "text-muted-foreground";
	const isRemoteDeviceOffline =
		hostType === "remote-device" && hostIsOnline === false;

	const renderPrimaryIcon = () => {
		if (pullRequestState) {
			const PrIcon = PR_ICON_BY_STATE[pullRequestState];
			return (
				<PrIcon
					className={cn("size-3.5", PR_COLOR_BY_STATE[pullRequestState])}
					strokeWidth={1.75}
				/>
			);
		}

		if (hostType === "local-device") {
			// A terminal square for the repo checkout and a branch glyph for a
			// worktree. The laptop and the bare dot they replace said "this is a
			// computer" and "this is a thing" — neither of which is in question in
			// a list of workspaces. What you actually want to know at a glance is
			// which of these is the checkout and which are branches off it.
			if (workspaceType === "main") {
				return (
					<LuSquareTerminal
						className={cn("size-4 transition-colors", iconColor)}
						strokeWidth={1.75}
					/>
				);
			}

			return (
				<LuGitBranch
					className={cn("size-4 transition-colors", iconColor)}
					strokeWidth={1.75}
				/>
			);
		}

		if (isRemoteDeviceOffline) {
			return (
				<TbCloudOff
					className={cn("size-4 transition-colors", iconColor, "opacity-60")}
					strokeWidth={1.75}
				/>
			);
		}

		return (
			<TbCloud
				className={cn("size-4 transition-colors", iconColor)}
				strokeWidth={1.75}
			/>
		);
	};

	return (
		<>
			{isCreatePending || workspaceStatus === "working" ? (
				<AsciiSpinner className="text-base" />
			) : (
				renderPrimaryIcon()
			)}
			{workspaceStatus && workspaceStatus !== "working" && (
				<span className={cn("absolute", overlayPosition)}>
					<StatusIndicator status={workspaceStatus} />
				</span>
			)}
		</>
	);
}
