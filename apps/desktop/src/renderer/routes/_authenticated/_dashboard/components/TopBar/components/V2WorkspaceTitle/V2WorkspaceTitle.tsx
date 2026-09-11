import { OverflowFadeText } from "@superset/ui/overflow-fade-text";
import { ChevronRight, Folder, GitBranch } from "lucide-react";
import { useSkinTokens } from "renderer/hooks/useSkinTokens";
import { useHostWorkspaces } from "renderer/routes/_authenticated/providers/HostWorkspacesProvider";
import { getV2WorkspaceDisplayName } from "renderer/utils/getV2WorkspaceDisplayName";

interface V2WorkspaceTitleProps {
	workspaceId: string;
}

export function V2WorkspaceTitle({ workspaceId }: V2WorkspaceTitleProps) {
	const { topBarTitle } = useSkinTokens();
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

	/*
	 * Which project am I in, first and largest.
	 *
	 * The breadcrumb reads name > branch > folder, which puts the WORKSPACE
	 * name in the primary slot. That is only useful when workspaces are named
	 * after something; the common case here is a workspace called "local"
	 * leading a line whose actual subject — SecondBrain — is last and dimmest.
	 * So this variant leads with the folder, which is the thing that differs
	 * between every window, and demotes the branch to a trailing clause after a
	 * rule rather than a second breadcrumb step.
	 *
	 * The workspace name is not dropped: it trails, dim, and only when it says
	 * something the folder does not.
	 */
	if (topBarTitle === "workspace-first") {
		const primary = folder ?? name;
		const trailingName = name && name !== folder ? name : null;
		return (
			<div className="flex min-w-0 max-w-full items-center gap-2 text-[13px] tracking-tight">
				{primary && (
					<OverflowFadeText
						className="font-medium text-foreground"
						title={workspace?.worktreePath ?? primary}
					>
						{primary}
					</OverflowFadeText>
				)}
				{primary && branch && (
					<span aria-hidden="true" className="h-4 w-px shrink-0 bg-border" />
				)}
				{branch && (
					<span
						className="flex min-w-0 items-center gap-1 text-[12.5px] text-muted-foreground"
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
				{trailingName && (
					<span
						className="flex min-w-0 shrink items-center text-[12px] text-muted-foreground/45"
						title={`Workspace: ${trailingName}`}
					>
						<OverflowFadeText>{trailingName}</OverflowFadeText>
					</span>
				)}
			</div>
		);
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
