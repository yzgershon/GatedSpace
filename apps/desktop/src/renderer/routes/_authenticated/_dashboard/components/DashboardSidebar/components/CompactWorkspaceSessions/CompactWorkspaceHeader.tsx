import type {
	DraggableAttributes,
	DraggableSyntheticListeners,
} from "@dnd-kit/core";
import { ChevronRight, Plus } from "lucide-react";
import type { ReactNode } from "react";
import "./compact-workspace.css";

export interface CompactWorkspaceProject {
	name: string;
	isCollapsed: boolean;
	onToggle: () => void;
	onNewWorkspace: () => void;
	actions: ReactNode;
	dragAttributes?: DraggableAttributes;
	dragListeners?: DraggableSyntheticListeners;
}

export function CompactWorkspaceHeader({
	project,
	branch,
	active,
	onOpen,
}: {
	project: CompactWorkspaceProject;
	branch: string;
	active: boolean;
	onOpen: () => void;
}) {
	return (
		<div className="compact-workspace-header">
			<button
				type="button"
				className="compact-workspace-action"
				aria-label={`${project.isCollapsed ? "Expand" : "Collapse"} ${project.name} sessions`}
				aria-expanded={!project.isCollapsed}
				onClick={project.onToggle}
			>
				<ChevronRight
					size={14}
					className={!project.isCollapsed ? "rotate-90" : undefined}
				/>
			</button>
			<button
				type="button"
				className="compact-workspace-open"
				{...project.dragAttributes}
				{...project.dragListeners}
				aria-label={`Open ${project.name} workspace`}
				aria-current={active ? "page" : undefined}
				title={`${project.name} · ${branch}`}
				onClick={onOpen}
			>
				<strong>{project.name}</strong>
				<span className="compact-workspace-branch">{branch}</span>
			</button>
			<button
				type="button"
				className="compact-workspace-action"
				aria-label={`New workspace in ${project.name}`}
				onClick={project.onNewWorkspace}
			>
				<Plus size={14} />
			</button>
			{project.actions}
		</div>
	);
}
