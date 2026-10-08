import { ChevronDown, Folder, GitBranch, Pin, Plus } from "lucide-react";
import { useState } from "react";
import type { Direction, Session, Workspace } from "../data";

export function WorkspaceRow({
	workspace,
	sessions,
	direction,
	onPin,
	onOpen,
}: {
	workspace: Workspace;
	sessions: Session[];
	direction: Direction;
	onPin: () => void;
	onOpen: (name: string) => void;
}) {
	const [expanded, setExpanded] = useState(workspace.id === "gatedspace");
	const working = sessions.filter((s) => s.status === "working").length;
	const questions = sessions.filter((s) => s.status === "question").length;
	return (
		<section className={`workspace-row ${expanded ? "expanded" : ""}`}>
			<div className="workspace-heading">
				<button
					type="button"
					className="workspace-toggle"
					onClick={() => setExpanded(!expanded)}
					aria-expanded={expanded}
				>
					<span className="workspace-icon">
						<Folder />
					</span>
					<span className="workspace-copy">
						<span className="row-title">{workspace.name}</span>
						<span className="row-meta">
							{questions
								? `${questions} needs your reply`
								: working
									? `${working} agents working`
									: `${sessions.length} sessions`}
						</span>
					</span>
					<ChevronDown className={expanded ? "chevron expanded" : "chevron"} />
				</button>
				<button
					type="button"
					className={`icon-button workspace-pin ${workspace.pinned ? "is-pinned" : ""}`}
					aria-label={`${workspace.pinned ? "Unpin" : "Pin"} workspace ${workspace.name}`}
					aria-pressed={workspace.pinned}
					onClick={onPin}
				>
					<Pin />
				</button>
			</div>
			{expanded && (
				<div className="workspace-body">
					{direction === "collections" && (
						<p className="workspace-path" title={workspace.path}>
							{workspace.path}
						</p>
					)}
					{workspace.branches.map((branch, index) => (
						<button
							type="button"
							className={`branch-row ${index === 0 ? "current-branch" : ""}`}
							key={branch}
							onClick={() => onOpen(`${workspace.name} / ${branch}`)}
						>
							<GitBranch />
							<span>{branch}</span>
							<span className="branch-count">
								{index === 0 ? Math.max(1, sessions.length - 1) : 1}
							</span>
						</button>
					))}
					{direction !== "focus" && (
						<div className="workspace-session-peek">
							{sessions.slice(0, 2).map((s) => (
								<button
									type="button"
									key={s.id}
									onClick={() => onOpen(s.title)}
								>
									<span className={`state-dot ${s.status}`} />
									<span>{s.title}</span>
								</button>
							))}
						</div>
					)}
					<button
						type="button"
						className="workspace-add"
						onClick={() => onOpen(`New session in ${workspace.name}`)}
					>
						<Plus />
						New session
					</button>
				</div>
			)}
		</section>
	);
}
