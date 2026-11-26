import type {
	DashboardSidebarProject,
	DashboardSidebarProjectChild,
} from "../types";

export function sortWorkspaceProjects(
	projects: DashboardSidebarProject[],
	openedAt: Record<string, number>,
	recentFirst: boolean,
	pinnedIds: string[],
): DashboardSidebarProject[] {
	const visit = (id: string) => openedAt[id] ?? 0;
	const childVisit = (child: DashboardSidebarProjectChild): number =>
		child.type === "workspace"
			? visit(child.workspace.id)
			: Math.max(
					0,
					...child.section.workspaces.map((workspace) => visit(workspace.id)),
				);
	const projectVisit = (project: DashboardSidebarProject) =>
		Math.max(0, ...project.children.map(childVisit));
	const ordered = projects.map((project) =>
		recentFirst
			? {
					...project,
					children: project.children
						.map((child) =>
							child.type === "section"
								? {
										...child,
										section: {
											...child.section,
											workspaces: [...child.section.workspaces].sort(
												(a, b) => visit(b.id) - visit(a.id),
											),
										},
									}
								: child,
						)
						.sort((a, b) => childVisit(b) - childVisit(a)),
				}
			: project,
	);
	return ordered.sort(
		(a, b) =>
			Number(pinnedIds.includes(b.id)) - Number(pinnedIds.includes(a.id)) ||
			(recentFirst ? projectVisit(b) - projectVisit(a) : 0),
	);
}
