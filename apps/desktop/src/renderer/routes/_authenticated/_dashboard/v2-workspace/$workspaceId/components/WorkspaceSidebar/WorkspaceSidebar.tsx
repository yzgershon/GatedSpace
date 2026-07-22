import { Button } from "@superset/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@superset/ui/tooltip";
import { eq } from "@tanstack/db";
import { useLiveQuery } from "@tanstack/react-db";
import { Globe, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { LuFile, LuGitCompareArrows } from "react-icons/lu";
import { useWorkspaceGitStatus } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/providers/WorkspaceGitStatusProvider";
import { useCollections } from "renderer/routes/_authenticated/providers/CollectionsProvider";
import { useSettings } from "renderer/stores/settings";
import type { CommentPaneData, DiffFocusSide } from "../../types";
import { BrowserTab } from "./components/BrowserTab";
import { FilesTab } from "./components/FilesTab";
import { SidebarHeader } from "./components/SidebarHeader";
import { useChangesTab } from "./hooks/useChangesTab";
import { useReviewTab } from "./hooks/useReviewTab";
import type { SidebarTabDefinition } from "./types";

type SidebarTabId = "changes" | "files" | "browser";

const VALID_TAB_IDS: readonly SidebarTabId[] = ["changes", "files", "browser"];

function isSidebarTabId(tab: string): tab is SidebarTabId {
	return (VALID_TAB_IDS as readonly string[]).includes(tab);
}

export interface PendingReveal {
	path: string;
	isDirectory: boolean;
}

interface WorkspaceSidebarProps {
	onSelectFile: (absolutePath: string, openInNewTab?: boolean) => void;
	onSelectDiffFile?: (
		path: string,
		openInNewTab?: boolean,
		line?: number,
		side?: DiffFocusSide,
		changeKey?: string,
	) => void;
	onOpenComment?: (comment: CommentPaneData) => void;
	onSearch?: () => void;
	/** Open a URL in an in-app browser pane (Browser tab pop-out). */
	onOpenBrowserUrl?: (url: string) => void;
	/** Whether the sidebar is currently in wide mode (Browser tab toggle). */
	isWide?: boolean;
	/** Toggle the sidebar between its normal width and wide. */
	onToggleWide?: () => void;
	selectedFilePath?: string;
	pendingReveal?: PendingReveal | null;
	workspaceId: string;
}

function IconButton({
	icon: Icon,
	tooltip,
	onClick,
}: {
	icon: React.ComponentType<{ className?: string }>;
	tooltip: string;
	onClick?: () => void;
}) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button
					variant="ghost"
					size="icon"
					className="size-6"
					onClick={onClick}
				>
					<Icon className="size-3.5" />
				</Button>
			</TooltipTrigger>
			<TooltipContent side="bottom">{tooltip}</TooltipContent>
		</Tooltip>
	);
}

export function WorkspaceSidebar({
	onSelectFile,
	onSelectDiffFile,
	onOpenComment,
	onSearch,
	onOpenBrowserUrl,
	isWide,
	onToggleWide,
	selectedFilePath,
	pendingReveal,
	workspaceId,
}: WorkspaceSidebarProps) {
	const gitStatus = useWorkspaceGitStatus();
	const collections = useCollections();
	const { data: [localState] = [] } = useLiveQuery(
		(query) =>
			query
				.from({ localState: collections.v2WorkspaceLocalState })
				.where(({ localState }) => eq(localState.workspaceId, workspaceId)),
		[collections, workspaceId],
	);
	// Persisted "review"/"preview" values (retired tabs) fail this guard and
	// fall back to "changes", which is the intended migration.
	const activeTab: SidebarTabId =
		localState && isSidebarTabId(localState.sidebarState.activeTab)
			? localState.sidebarState.activeTab
			: "changes";

	function setActiveTab(tab: string) {
		if (!isSidebarTabId(tab)) return;
		if (!collections.v2WorkspaceLocalState.get(workspaceId)) return;
		collections.v2WorkspaceLocalState.update(workspaceId, (draft) => {
			draft.sidebarState.activeTab = tab;
		});
	}

	const containerRef = useRef<HTMLDivElement>(null);
	const [compact, setCompact] = useState(false);
	useEffect(() => {
		const el = containerRef.current;
		if (!el) return;
		const ro = new ResizeObserver(([entry]) => {
			if (!entry) return;
			const width = entry.contentRect.width;
			// Hysteresis so labels don't jitter on the breakpoint edge.
			setCompact((prev) => (prev ? width < 280 : width < 260));
		});
		ro.observe(el);
		return () => ro.disconnect();
	}, []);

	const changesTabDef = useChangesTab({
		workspaceId,
		selectedFilePath,
		onSelectFile: onSelectDiffFile
			? (path, openInNewTab, changeKey) =>
					onSelectDiffFile(path, openInNewTab, undefined, undefined, changeKey)
			: undefined,
		onOpenFile: onSelectFile,
	});

	// Review is no longer its own tab — its content is folded into Changes,
	// shown above the file changes only when a PR or comments exist.
	const reviewTab = useReviewTab({
		workspaceId,
		onOpenComment,
		onOpenInDiff: onSelectDiffFile
			? (path, line, openInNewTab, side) => {
					// Force annotations on so the user lands on the comment, not an empty line.
					useSettings.getState().update("showDiffComments", true);
					onSelectDiffFile(path, openInNewTab ?? false, line, side);
				}
			: undefined,
	});

	const changesTab: SidebarTabDefinition = {
		...changesTabDef,
		icon: LuGitCompareArrows,
		content: reviewTab.hasContent ? (
			<div className="flex min-h-0 flex-1 flex-col">
				<div className="flex max-h-[45%] shrink-0 flex-col overflow-y-auto border-b border-border">
					{reviewTab.content}
				</div>
				<div className="flex min-h-0 flex-1 flex-col">
					{changesTabDef.content}
				</div>
			</div>
		) : (
			changesTabDef.content
		),
	};

	const filesTab: SidebarTabDefinition = {
		id: "files",
		label: "Files",
		icon: LuFile,
		actions: <IconButton icon={Search} tooltip="Search" onClick={onSearch} />,
		content: (
			<FilesTab
				onSelectFile={onSelectFile}
				selectedFilePath={selectedFilePath}
				pendingReveal={pendingReveal}
				workspaceId={workspaceId}
				gitStatus={gitStatus.data}
			/>
		),
	};

	const browserTab: SidebarTabDefinition = {
		id: "browser",
		label: "Browser",
		icon: Globe,
		content: (
			<BrowserTab
				workspaceId={workspaceId}
				onOpenBrowserUrl={onOpenBrowserUrl}
				isWide={isWide}
				onToggleWide={onToggleWide}
			/>
		),
	};

	const tabs: SidebarTabDefinition[] = [filesTab, changesTab, browserTab];
	const activeTabDef = tabs.find((t) => t.id === activeTab);

	return (
		<div
			ref={containerRef}
			className="isolate flex h-full w-full min-h-0 flex-col overflow-hidden bg-background"
		>
			<SidebarHeader
				tabs={tabs}
				activeTab={activeTab}
				onTabChange={setActiveTab}
				compact={compact}
			/>
			<div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
				{activeTabDef?.content}
			</div>
		</div>
	);
}
