import { useSettings } from "renderer/stores/settings";
import type { CommentPaneData, DiffFocusSide } from "../../../../types";
import { useChangesTab } from "../../../WorkspaceSidebar/hooks/useChangesTab";
import { useReviewTab } from "../../../WorkspaceSidebar/hooks/useReviewTab";

export function ChangesTool({
	workspaceId,
	selectedFilePath,
	onOpenFile,
	onSelectDiff,
	onOpenComment,
}: {
	workspaceId: string;
	selectedFilePath?: string;
	onOpenFile: (path: string, newTab?: boolean) => void;
	onSelectDiff: (
		path: string,
		newTab?: boolean,
		line?: number,
		side?: DiffFocusSide,
		changeKey?: string,
	) => void;
	onOpenComment: (comment: CommentPaneData) => void;
}) {
	const changes = useChangesTab({
		workspaceId,
		selectedFilePath,
		onOpenFile,
		onSelectFile: (path, newTab, key) =>
			onSelectDiff(path, newTab, undefined, undefined, key),
	});
	const review = useReviewTab({
		workspaceId,
		onOpenComment,
		onOpenInDiff: (path, line, newTab, side) => {
			useSettings.getState().update("showDiffComments", true);
			onSelectDiff(path, newTab, line, side);
		},
	});
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="flex shrink-0 items-center justify-end gap-1 border-b border-border/50 px-2 py-1">
				{changes.actions}
			</div>
			{review.hasContent && (
				<div className="flex max-h-[45%] shrink-0 flex-col overflow-y-auto border-b border-border">
					{review.content}
				</div>
			)}
			<div className="flex min-h-0 flex-1 flex-col">{changes.content}</div>
		</div>
	);
}
