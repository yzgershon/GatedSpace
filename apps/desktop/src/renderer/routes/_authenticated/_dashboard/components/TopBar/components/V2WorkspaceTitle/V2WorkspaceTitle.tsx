import { OverflowFadeText } from "@superset/ui/overflow-fade-text";
import { ChevronRight, Folder, GitBranch } from "lucide-react";
import { useHostWorkspaces } from "renderer/routes/_authenticated/providers/HostWorkspacesProvider";
import { getV2WorkspaceDisplayName } from "renderer/utils/getV2WorkspaceDisplayName";

interface V2WorkspaceTitleProps {
	workspaceId: string;
}

export function V2WorkspaceTitle({ workspaceId }: V2WorkspaceTitleProps) {
	const { workspaces } = useHostWorkspaces();
	const workspace = workspaces.find((w) => w.id === workspaceId) ?? null;
	const name = workspace ? getV2WorkspaceDisplayName(workspace) || null : null;
	const rawBranch = workspace?.branch ?? null;
	// The display name falls back to the branch for unnamed worktrees; don't
	// render the same text twice.
	const branch = rawBranch === name ? null : rawBranch;

	/**
	 * The folder the session is actually working in.
	 *
	 * Once workspaces stop being named after their folder, the title alone no
	 * longer says WHERE you are — "local > windows-port" is true of any repo.
	 * Every workspace has a different path, so this is read per-workspace rather
	 * than assumed. Renderer is a browser context with no node:path, so the
	 * basename is taken by hand and handles both separators.
	 */
	const folder = workspace?.worktreePath
		? (workspace.worktreePath
				.replace(/[/\\]+$/, "")
				.split(/[/\\]/)
				.pop() ?? null)
		: null;

	if (!name && !branch && !folder) {
		return null;
	}

	return (
		<div className="flex min-w-0 max-w-full items-center gap-1.5 text-[13px] tracking-tight">
			{name && (
				<OverflowFadeText className="font-medium text-foreground" title={name}>
					{name}
				</OverflowFadeText>
			)}
			{name && branch && (
				<ChevronRight
					className="size-3 shrink-0 text-muted-foreground/40"
					strokeWidth={2}
					aria-hidden="true"
				/>
			)}
			{branch && (
				<span
					className="flex min-w-0 items-center gap-1 text-muted-foreground"
					title={branch}
				>
					<GitBranch
						className="size-3 shrink-0 opacity-70"
						strokeWidth={2}
						aria-hidden="true"
					/>
					<OverflowFadeText>{branch}</OverflowFadeText>
				</span>
			)}
			{folder && (
				/*
				 * Dimmer than the branch and last in the line: it answers "which
				 * project is this" only when you go looking, and should not compete
				 * with the name you chose for the workspace.
				 */
				<span
					className="flex min-w-0 shrink items-center gap-1 text-muted-foreground/60"
					title={workspace?.worktreePath ?? folder}
				>
					<Folder
						className="size-3 shrink-0 opacity-70"
						strokeWidth={2}
						aria-hidden="true"
					/>
					<OverflowFadeText>{folder}</OverflowFadeText>
				</span>
			)}
		</div>
	);
}
