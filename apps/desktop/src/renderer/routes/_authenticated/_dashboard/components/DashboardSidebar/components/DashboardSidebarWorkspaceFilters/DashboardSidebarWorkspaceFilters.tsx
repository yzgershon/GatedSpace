import { ListFilter, Search, X } from "lucide-react";
import "./workspace-filters.css";

interface DashboardSidebarWorkspaceFiltersProps {
	query: string;
	onQueryChange: (query: string) => void;
	projectCount: number;
	activeOnly: boolean;
	onActiveOnlyChange: (activeOnly: boolean) => void;
}

export function DashboardSidebarWorkspaceFilters({
	query,
	onQueryChange,
	projectCount,
	activeOnly,
	onActiveOnlyChange,
}: DashboardSidebarWorkspaceFiltersProps) {
	return (
		<div className="workspace-collection-controls">
			<label className="workspace-collection-search">
				<Search size={14} aria-hidden="true" />
				<input
					aria-label="Search workspaces"
					placeholder="Find a project or branch"
					value={query}
					onChange={(event) => onQueryChange(event.target.value)}
				/>
				{query && (
					<button
						type="button"
						aria-label="Clear workspace search"
						onClick={() => onQueryChange("")}
					>
						<X size={14} aria-hidden="true" />
					</button>
				)}
			</label>
			<div className="workspace-collection-filters">
				<span>
					{projectCount} {projectCount === 1 ? "project" : "projects"}
				</span>
				<button
					type="button"
					aria-pressed={activeOnly}
					title="Show workspaces with agents working or waiting for your reply"
					onClick={() => onActiveOnlyChange(!activeOnly)}
				>
					<ListFilter size={14} aria-hidden="true" />
					Active only
				</button>
			</div>
		</div>
	);
}
