import { workspaceTrpc } from "@superset/workspace-client";
import { CodexSession } from "renderer/components/CodexSession/CodexSession";
import { useWorkspaceHostTarget } from "renderer/hooks/host-service/useWorkspaceHostUrl";

export function CodexSessionPane(props: {
	paneId: string;
	workspaceId: string;
	model?: string;
	resumeSessionId?: string;
	forkSession?: boolean;
	cwdOverride?: string;
	paneCount: number;
	isActive: boolean;
	onSessionId: (id: string) => void;
	onReviewChanges?: () => void;
}) {
	const workspace = workspaceTrpc.workspace.get.useQuery(
		{ id: props.workspaceId },
		{ staleTime: 30_000 },
	);
	const host = useWorkspaceHostTarget(props.workspaceId);
	if (host.status === "ready" && host.kind === "remote")
		return (
			<p className="p-8 text-sm text-muted-foreground select-text">
				Native Codex runs on this machine. Open Codex in a terminal for this
				remote workspace.
			</p>
		);
	const cwd = props.cwdOverride || workspace.data?.worktreePath;
	if (!cwd || host.status !== "ready")
		return (
			<p className="p-8 text-sm text-muted-foreground">Opening workspace…</p>
		);
	return <CodexSession {...props} cwd={cwd} />;
}
