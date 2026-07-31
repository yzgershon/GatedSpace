/**
 * The project tree's shape, before the workspace list has arrived.
 *
 * The sidebar renders straight from `groups`, so an empty list and a list that
 * hasn't loaded looked identical: a blank panel for the second or two the local
 * host service takes to come up. Blank read as "your projects are gone".
 *
 * Row geometry is copied from the real rows, not approximated — project rows
 * are `min-h-9 pl-3 pr-2` with a `size-4` leading icon, workspace rows sit
 * indented under them. Matching those means the tree does not visibly reflow
 * when the real rows land.
 */
import { Skeleton } from "@superset/ui/skeleton";

/**
 * Shape of a plausible tree, fixed rather than random: two projects with a few
 * workspaces each. Stable widths keep the bars from twitching between renders.
 */
const PROJECTS = [
	{ name: "w-28", workspaces: ["w-16", "w-24"] },
	{ name: "w-36", workspaces: ["w-20", "w-28", "w-16"] },
	{ name: "w-24", workspaces: ["w-24"] },
] as const;

export function DashboardSidebarSkeleton() {
	return (
		// `output` carries role="status" natively, so the wait is announced
		// instead of the panel reading as empty.
		<output
			className="flex flex-col"
			aria-busy="true"
			aria-label="Loading projects"
		>
			{PROJECTS.map((project) => (
				<div
					key={project.name}
					className="border-b border-border/45 last:border-b-0"
				>
					{/*
					 * Project rows keep Skeleton's own `bg-accent`; workspace rows drop
					 * to 55% of it, so the tree reads as a hierarchy rather than a flat
					 * stack. Relative to the primitive, not a hand-picked colour —
					 * `--muted` and `--accent` are the same value in the default theme,
					 * so absolute opacities here render fainter than they look.
					 */}
					<div className="flex min-h-9 w-full items-center gap-2 py-1 pr-2 pl-3">
						<Skeleton className="size-4 shrink-0 rounded" />
						<Skeleton className={`h-3.5 rounded ${project.name}`} />
					</div>
					<div className="flex flex-col pb-1">
						{project.workspaces.map((workspace) => (
							<div
								key={workspace}
								className="flex min-h-7 items-center gap-2 py-0.5 pr-2 pl-7"
							>
								<Skeleton className="size-3.5 shrink-0 rounded bg-accent/55" />
								<Skeleton className={`h-3 rounded bg-accent/55 ${workspace}`} />
							</div>
						))}
					</div>
				</div>
			))}
		</output>
	);
}
