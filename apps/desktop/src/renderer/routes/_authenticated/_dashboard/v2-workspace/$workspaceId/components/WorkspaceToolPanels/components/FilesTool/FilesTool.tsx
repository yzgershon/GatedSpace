import { Search } from "lucide-react";
import { useWorkspaceGitStatus } from "../../../../providers/WorkspaceGitStatusProvider";
import { FilesTab } from "../../../WorkspaceSidebar/components/FilesTab";

export function FilesTool({
	workspaceId,
	onSelectFile,
	selectedFilePath,
	pendingReveal,
	onSearch,
}: {
	workspaceId: string;
	onSelectFile: (path: string, newTab?: boolean) => void;
	selectedFilePath?: string;
	pendingReveal?: { path: string; isDirectory: boolean } | null;
	onSearch: () => void;
}) {
	const gitStatus = useWorkspaceGitStatus();
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="flex justify-end border-b border-border/50 px-2 py-1">
				<button
					type="button"
					className="gs-tool-icon"
					title="Find a file"
					aria-label="Find a file"
					onClick={onSearch}
				>
					<Search className="size-4" />
				</button>
			</div>
			<FilesTab
				workspaceId={workspaceId}
				onSelectFile={onSelectFile}
				selectedFilePath={selectedFilePath}
				pendingReveal={pendingReveal}
				gitStatus={gitStatus.data}
			/>
		</div>
	);
}
