import type {
	DraggableAttributes,
	DraggableSyntheticListeners,
} from "@dnd-kit/core";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@superset/ui/dropdown-menu";
import { AnimatePresence, motion } from "framer-motion";
import { MoreHorizontal } from "lucide-react";
import { useMemo } from "react";
import type { DashboardSidebarProject } from "../../types";
import { getProjectChildrenWorkspaces } from "../../utils/projectChildren";
import { DashboardSidebarWorkspaceItem } from "../DashboardSidebarWorkspaceItem";
import { DashboardSidebarCollapsedProjectContent } from "./components/DashboardSidebarCollapsedProjectContent";
import { DashboardSidebarExpandedProjectContent } from "./components/DashboardSidebarExpandedProjectContent";
import { DashboardSidebarProjectContextMenu } from "./components/DashboardSidebarProjectContextMenu";
import { DashboardSidebarProjectRow } from "./components/DashboardSidebarProjectRow";
import { useDashboardSidebarProjectSectionActions } from "./hooks/useDashboardSidebarProjectSectionActions";

interface DashboardSidebarProjectSectionProps {
	project: DashboardSidebarProject;
	isSidebarCollapsed?: boolean;
	isDraggingProject?: boolean;
	workspaceShortcutLabels: Map<string, string>;
	onWorkspaceHover: (workspaceId: string) => void | Promise<void>;
	onToggleCollapse: (projectId: string) => void;
	dragHandleListeners?: DraggableSyntheticListeners;
	dragHandleAttributes?: DraggableAttributes;
}

export function DashboardSidebarProjectSection({
	project,
	isSidebarCollapsed = false,
	isDraggingProject = false,
	workspaceShortcutLabels,
	onWorkspaceHover,
	onToggleCollapse,
	dragHandleListeners,
	dragHandleAttributes,
}: DashboardSidebarProjectSectionProps) {
	const flattenedCollapsedWorkspaces = useMemo(
		() => getProjectChildrenWorkspaces(project.children),
		[project.children],
	);

	const {
		cancelRename,
		confirmRemoveFromSidebar,
		deleteSection,
		handleNewSection,
		handleNewWorkspace,
		handleOpenInFinder,
		handleOpenSettings,
		isRenaming,
		renameSection,
		renameValue,
		setRenameValue,
		startRename,
		submitRename,
		toggleSectionCollapsed,
	} = useDashboardSidebarProjectSectionActions({
		project,
	});

	const totalWorkspaceCount = flattenedCollapsedWorkspaces.length;

	if (isSidebarCollapsed) {
		return (
			<DashboardSidebarProjectContextMenu
				onCreateSection={handleNewSection}
				onOpenInFinder={handleOpenInFinder}
				onOpenSettings={handleOpenSettings}
				onRemoveFromSidebar={confirmRemoveFromSidebar}
				onRename={startRename}
			>
				<div>
					<DashboardSidebarCollapsedProjectContent
						projectName={project.name}
						iconUrl={project.iconUrl}
						isCollapsed={project.isCollapsed}
						totalWorkspaceCount={totalWorkspaceCount}
						workspaces={flattenedCollapsedWorkspaces}
						workspaceShortcutLabels={workspaceShortcutLabels}
						onWorkspaceHover={onWorkspaceHover}
						onToggleCollapse={() => onToggleCollapse(project.id)}
					/>
				</div>
			</DashboardSidebarProjectContextMenu>
		);
	}

	const onlyChild =
		project.children.length === 1 ? project.children[0] : undefined;
	// A local project's only checkout does not need a second, repeated header.
	if (
		onlyChild?.type === "workspace" &&
		onlyChild.workspace.type === "main" &&
		!onlyChild.workspace.pendingTransaction &&
		!isRenaming
	) {
		return (
			<DashboardSidebarWorkspaceItem
				workspace={onlyChild.workspace}
				shortcutLabel={workspaceShortcutLabels.get(onlyChild.workspace.id)}
				onHoverCardOpen={() => {
					void onWorkspaceHover(onlyChild.workspace.id);
				}}
				compactProject={{
					name: project.name,
					isCollapsed: project.isCollapsed,
					onToggle: () => onToggleCollapse(project.id),
					onNewWorkspace: handleNewWorkspace,
					dragAttributes: dragHandleAttributes,
					dragListeners: dragHandleListeners,
					actions: (
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<button
									type="button"
									className="compact-workspace-action"
									aria-label={`${project.name} workspace actions`}
								>
									<MoreHorizontal size={14} />
								</button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="start">
								<DropdownMenuItem onSelect={startRename}>
									Rename project
								</DropdownMenuItem>
								<DropdownMenuItem onSelect={handleOpenInFinder}>
									Open in File Explorer
								</DropdownMenuItem>
								<DropdownMenuItem onSelect={handleOpenSettings}>
									Project settings
								</DropdownMenuItem>
								<DropdownMenuItem onSelect={handleNewSection}>
									New group
								</DropdownMenuItem>
								<DropdownMenuItem onSelect={confirmRemoveFromSidebar}>
									Remove from sidebar
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
					),
				}}
			/>
		);
	}

	return (
		<div>
			<DashboardSidebarProjectContextMenu
				onCreateSection={handleNewSection}
				onOpenInFinder={handleOpenInFinder}
				onOpenSettings={handleOpenSettings}
				onRemoveFromSidebar={confirmRemoveFromSidebar}
				onRename={startRename}
			>
				<DashboardSidebarProjectRow
					projectName={project.name}
					iconUrl={project.iconUrl}
					totalWorkspaceCount={totalWorkspaceCount}
					isCollapsed={project.isCollapsed}
					isRenaming={isRenaming}
					renameValue={renameValue}
					onRenameValueChange={setRenameValue}
					onSubmitRename={submitRename}
					onCancelRename={cancelRename}
					onStartRename={startRename}
					onToggleCollapse={() => onToggleCollapse(project.id)}
					onNewWorkspace={handleNewWorkspace}
					{...(dragHandleAttributes ?? {})}
					{...(dragHandleListeners ?? {})}
				/>
			</DashboardSidebarProjectContextMenu>

			<AnimatePresence initial={false}>
				{!isDraggingProject && (
					<motion.div
						initial={{ height: 0, opacity: 0 }}
						animate={{ height: "auto", opacity: 1 }}
						exit={{ height: 0, opacity: 0 }}
						transition={{ duration: 0.15, ease: "easeOut" }}
						className="overflow-hidden"
					>
						<DashboardSidebarExpandedProjectContent
							projectId={project.id}
							isCollapsed={project.isCollapsed}
							projectChildren={project.children}
							workspaceShortcutLabels={workspaceShortcutLabels}
							onWorkspaceHover={onWorkspaceHover}
							onDeleteSection={deleteSection}
							onRenameSection={renameSection}
							onToggleSectionCollapse={toggleSectionCollapsed}
						/>
					</motion.div>
				)}
			</AnimatePresence>
		</div>
	);
}
