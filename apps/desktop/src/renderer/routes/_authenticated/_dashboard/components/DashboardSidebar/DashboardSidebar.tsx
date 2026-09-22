import {
	closestCenter,
	DndContext,
	type DragEndEvent,
	DragOverlay,
	KeyboardSensor,
	MeasuringStrategy,
	MouseSensor,
	TouchSensor,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import {
	arrayMove,
	SortableContext,
	sortableKeyboardCoordinates,
	useSortable,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@superset/ui/utils";
import { useMatchRoute, useNavigate, useParams } from "@tanstack/react-router";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useSkinTokens } from "renderer/hooks/useSkinTokens";
import { getHostTrpcClient } from "renderer/lib/host-trpc-client";
import {
	DEFAULT_COLS,
	DEFAULT_ROWS,
} from "renderer/lib/terminal/terminal-runtime";
import { OrganizationDropdown } from "renderer/routes/_authenticated/_dashboard/components/TopBar/components/OrganizationDropdown";
import { useDashboardSidebarState } from "renderer/routes/_authenticated/hooks/useDashboardSidebarState";
import { useCollections } from "renderer/routes/_authenticated/providers/CollectionsProvider";
import { useLocalHostService } from "renderer/routes/_authenticated/providers/LocalHostServiceProvider";
import { useInlineWorkspacePortsEnabled } from "renderer/stores/inline-workspace-ports";
import { useSidebarPanelStore } from "renderer/stores/sidebar-panel";
import { openSessionInWorkspace } from "renderer/stores/workspace-creates/openSessionInWorkspace";
import { openTerminalInWorkspace } from "renderer/stores/workspace-creates/openTerminalInWorkspace";
import { DashboardSidebarAccountRow } from "./components/DashboardSidebarAccountRow";
import { DashboardSidebarBrand } from "./components/DashboardSidebarBrand";
import { DashboardSidebarHeader } from "./components/DashboardSidebarHeader";
import { DashboardSidebarHoverCardOverlay } from "./components/DashboardSidebarHoverCardOverlay";
import { DashboardSidebarNav } from "./components/DashboardSidebarNav";
import { SidebarSessionsPanel } from "./components/DashboardSidebarPanels";
import { DashboardSidebarPortsList } from "./components/DashboardSidebarPortsList";
import { DashboardSidebarProjectSection } from "./components/DashboardSidebarProjectSection";
import { DashboardSidebarRail } from "./components/DashboardSidebarRail";
import { DashboardSidebarSectionRenameProvider } from "./components/DashboardSidebarSectionRenameContext";
import { DashboardSidebarSkeleton } from "./components/DashboardSidebarSkeleton";
import { DashboardSidebarUsageBar } from "./components/DashboardSidebarUsageBar";
import { V2SetupScriptCard } from "./components/V2SetupScriptCard";
import { useDashboardSidebarData } from "./hooks/useDashboardSidebarData";
import { useDashboardSidebarShortcuts } from "./hooks/useDashboardSidebarShortcuts";
import { DashboardSidebarHoverProvider } from "./providers/DashboardSidebarHoverProvider";
import { DashboardSidebarPortsProvider } from "./providers/DashboardSidebarPortsProvider";
import type { DashboardSidebarProject } from "./types";

interface DashboardSidebarProps {
	isCollapsed?: boolean;
	/**
	 * Applied to the root. Carries the sidebar's CSS zoom so the scale lands
	 * without inserting a wrapper element — an extra flex box between the
	 * resizable panel and this `flex h-full` root cropped the rail.
	 */
	style?: React.CSSProperties;
}

interface SortableProjectWrapperProps {
	project: DashboardSidebarProject;
	isCollapsed: boolean;
	isDraggingProject: boolean;
	workspaceShortcutLabels: Map<string, string>;
	onWorkspaceHover: (workspaceId: string) => void | Promise<void>;
	onToggleCollapse: (projectId: string) => void;
}

const SortableProjectWrapper = memo(function SortableProjectWrapper({
	project,
	isCollapsed,
	isDraggingProject,
	workspaceShortcutLabels,
	onWorkspaceHover,
	onToggleCollapse,
}: SortableProjectWrapperProps) {
	const {
		attributes,
		listeners,
		setNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable({ id: project.id });

	return (
		// The separator lives here, not on DashboardSidebarProjectSection: these
		// wrappers are the real siblings, so `last:` resolves correctly. On the
		// section itself it was always an only child, so last:border-b-0 always
		// matched and the border never rendered.
		<div
			/*
			 * Breathing room between projects.
			 *
			 * The rule alone was carrying the whole separation, so with six
			 * projects the tree was one unbroken column of 32px rows and the
			 * groups were only findable by reading them. Padding does the
			 * grouping and the rule just marks the seam.
			 */
			className="border-b border-border/45 py-1.5 last:border-b-0"
			ref={setNodeRef}
			style={{
				transform: CSS.Translate.toString(transform),
				transition,
				opacity: isDragging ? 0.5 : undefined,
			}}
		>
			<DashboardSidebarProjectSection
				project={project}
				isSidebarCollapsed={isCollapsed}
				isDraggingProject={isDraggingProject}
				workspaceShortcutLabels={workspaceShortcutLabels}
				onWorkspaceHover={onWorkspaceHover}
				onToggleCollapse={onToggleCollapse}
				dragHandleListeners={listeners}
				dragHandleAttributes={attributes}
			/>
		</div>
	);
});

export function DashboardSidebar({
	isCollapsed = false,
	style,
}: DashboardSidebarProps) {
	const {
		groups,
		isReady: sidebarDataReady,
		refreshWorkspacePullRequest,
		toggleProjectCollapsed,
	} = useDashboardSidebarData();
	const { reorderProjects } = useDashboardSidebarState();
	const navigate = useNavigate();
	const {
		accountPlacement,
		sidebarRail,
		sidebarCollapse,
		sidebarNav,
		sidebarFooterRows,
		sidebarSurface,
		shellChrome,
	} = useSkinTokens();
	const matchRoute = useMatchRoute();
	const { activeHostUrl } = useLocalHostService();
	const inlineWorkspacePortsEnabled = useInlineWorkspacePortsEnabled();
	const collections = useCollections();
	const { workspaceId: activeWorkspaceId } = useParams({ strict: false }) as {
		workspaceId?: string;
	};

	/**
	 * Open a session from the rail into the workspace you're in.
	 *
	 * With no workspace focused there's nowhere to put the pane, so this sends
	 * you to the workspace list rather than guessing which one you meant.
	 */
	const openSessionFromSidebar = useCallback(
		(request: {
			provider: "claude" | "codex";
			sessionId: string;
			cwd: string | null;
			title: string;
			mode: "resume" | "fork";
		}) => {
			if (
				activeWorkspaceId &&
				openSessionInWorkspace(collections, activeWorkspaceId, {
					provider: request.provider,
					sessionId: request.sessionId,
					cwd: request.cwd,
					title: request.title,
					fork: request.mode === "fork",
				})
			) {
				return;
			}
			navigate({ to: "/v2-workspaces" });
		},
		[activeWorkspaceId, collections, navigate],
	);

	/**
	 * Resume a session in a real terminal, rather than handing you a command to
	 * paste somewhere else.
	 *
	 * The command itself is unchanged — `resumeCommandFor` builds it from the
	 * shared catalog, and it is the same string the copy action puts on the
	 * clipboard. What changes is that it runs here, as the terminal's initial
	 * command, so resuming is one click instead of copy, find a shell, paste.
	 *
	 * The session is created on host-service and AWAITED before the pane is
	 * written into the layout. The pane opens its WebSocket the moment it
	 * mounts, and a socket that arrives before the session exists renders as a
	 * dead terminal — the in-workspace launcher carries the same rule for the
	 * same reason.
	 *
	 * Cols and rows are passed for the reason the launcher passes them: the pty
	 * prints immediately, and a pty that starts at a different size from the
	 * xterm reflows its first output out of view.
	 */
	const resumeInTerminalFromSidebar = useCallback(
		async (request: {
			command: string;
			cwd: string | null;
			title: string;
			provider: string;
		}) => {
			if (!activeWorkspaceId) {
				navigate({ to: "/v2-workspaces" });
				return;
			}
			const client = getHostTrpcClient(activeHostUrl);
			if (!client) return;

			const terminalId = crypto.randomUUID();
			await client.terminal.createSession.mutate({
				terminalId,
				workspaceId: activeWorkspaceId,
				initialCommand: request.command,
				...(request.cwd ? { cwd: request.cwd } : {}),
				cols: DEFAULT_COLS,
				rows: DEFAULT_ROWS,
			});

			if (
				!openTerminalInWorkspace(collections, activeWorkspaceId, {
					terminalId,
					title: request.title,
					agentId: request.provider,
				})
			) {
				navigate({ to: "/v2-workspaces" });
			}
		},
		[activeWorkspaceId, activeHostUrl, collections, navigate],
	);

	const activePanel = useSidebarPanelStore((state) => state.activePanel);
	const panelOpen = useSidebarPanelStore((state) => state.panelOpen);
	const v2RouteMatch = matchRoute({ to: "/v2-workspace/$workspaceId" });
	const activeV2WorkspaceId = v2RouteMatch ? v2RouteMatch.workspaceId : null;

	const sensors = useSensors(
		useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
		useSensor(TouchSensor, {
			activationConstraint: { delay: 200, tolerance: 5 },
		}),
		useSensor(KeyboardSensor, {
			coordinateGetter: sortableKeyboardCoordinates,
		}),
	);

	const [activeProject, setActiveProject] =
		useState<DashboardSidebarProject | null>(null);

	// Local project order — syncs from groups, updated on drag end
	const [projectOrder, setProjectOrder] = useState(() =>
		groups.map((p) => p.id),
	);
	useEffect(() => {
		setProjectOrder(groups.map((p) => p.id));
	}, [groups]);

	const orderedGroups = useMemo(() => {
		const byId = new Map(groups.map((g) => [g.id, g]));
		const ordered = projectOrder
			.map((id) => byId.get(id))
			.filter((g): g is DashboardSidebarProject => g != null);
		const orderedIds = new Set(ordered.map((project) => project.id));
		return [
			...ordered,
			...groups.filter((project) => !orderedIds.has(project.id)),
		];
	}, [groups, projectOrder]);

	const workspaceShortcutLabels = useDashboardSidebarShortcuts(orderedGroups);

	/*
	 * Workspaces, counted across every project — what the brand row and the
	 * "Workspaces" nav row put on their right. Sections hold workspaces too, so
	 * a count of `project.children` would report the number of ROWS in the tree
	 * rather than the number of workspaces, and read low on any project that
	 * groups them.
	 */
	const workspaceCount = useMemo(
		() =>
			groups.reduce(
				(total, project) =>
					total +
					project.children.reduce(
						(count, child) =>
							count +
							(child.type === "workspace"
								? 1
								: child.section.workspaces.length),
						0,
					),
				0,
			),
		[groups],
	);

	// Only when there is genuinely nothing to show yet. A sidebar that already
	// has rows must keep them while a refetch is in flight, or every background
	// refresh would blink the tree away — the cache-first rule the workspace
	// read path is built on.
	const showSkeleton = !sidebarDataReady && orderedGroups.length === 0;

	const activeV2Project = useMemo(() => {
		if (!activeV2WorkspaceId) return null;
		for (const project of groups) {
			for (const child of project.children) {
				if (
					child.type === "workspace" &&
					child.workspace.id === activeV2WorkspaceId
				) {
					return project;
				}
				if (child.type === "section") {
					for (const ws of child.section.workspaces) {
						if (ws.id === activeV2WorkspaceId) return project;
					}
				}
			}
		}
		return null;
	}, [groups, activeV2WorkspaceId]);

	const handleDragEnd = useCallback(
		({ active, over }: DragEndEvent) => {
			if (over && active.id !== over.id) {
				const oldIndex = projectOrder.indexOf(String(active.id));
				const newIndex = projectOrder.indexOf(String(over.id));
				if (oldIndex !== -1 && newIndex !== -1) {
					const reordered = arrayMove(projectOrder, oldIndex, newIndex);
					setProjectOrder(reordered);
					reorderProjects(reordered);
				}
			}
			setActiveProject(null);
		},
		[projectOrder, reorderProjects],
	);

	return (
		<DashboardSidebarSectionRenameProvider>
			<DashboardSidebarHoverProvider>
				<DashboardSidebarPortsProvider enabled={!isCollapsed}>
					<DashboardSidebarHoverCardOverlay>
						<div
							className={cn(
								"flex h-full",
								/*
								 * A card, not a wall. A rounded pane sitting against a
								 * square-cornered sidebar reads as two unrelated systems
								 * sharing a window, which is exactly what he reported. The
								 * inset is HALF the pane gutter so the trough between the
								 * sidebar and the first pane comes out the same width as
								 * the trough between two panes — the pane side already
								 * contributes the other half.
								 */
								/*
								 * DOUBLE the inset vertically, to line up with the panes.
								 *
								 * `--gs-pane-inset` is HALF the gutter, because `Tab.tsx`
								 * pads the split root AND the leaf wrapper — so two panes
								 * get half from each and the outer edge gets both, landing
								 * at a full gutter. The sidebar has only one box, so a
								 * single half-inset put its top edge 9px above the pane's
								 * and its bottom 9px below. Reported as "the top and
								 * bottom edges of the pane should match the sidebar".
								 *
								 * The value comes from the layout rather than being spelled
								 * `calc(var(--gs-pane-inset)*2)` here, and that is the
								 * second half of the same bug. This element carries the
								 * sidebar's CSS `zoom`, which scales padding — so the
								 * doubled inset rendered at 18 × sidebarScale while the
								 * identical gutter around the panes rendered at
								 * 18 × mainScale. With the sidebar zoomed up (measured at
								 * 1.4 against a main of 1.0) its card sat 7px lower and 7px
								 * shorter than the pane beside it, which reads as exactly
								 * what it is: two grids that do not line up.
								 * `--gs-sidebar-gutter-*` is pre-divided by this element's
								 * own zoom, so the trough lands on the panes' at any pair
								 * of scales.
								 */
								sidebarSurface === "card" &&
									"py-[var(--gs-sidebar-gutter-y,0px)] pl-[var(--gs-sidebar-gutter-x,0px)]",
							)}
							style={style}
						>
							{/*
							 * Collapsed means "the rail IS the sidebar". Previously only
							 * the width changed, so the panel kept rendering into whatever
							 * pixels were left and got squeezed into an unreadable strip.
							 *
							 * Under Liquid Glass there is no rail at all: its three
							 * destinations are text rows at the top of the one sidebar, so
							 * a second 48px column would be the same list twice.
							 *
							 * It used to render whenever COLLAPSED regardless of skin, on
							 * the reasoning that collapsing had to leave something behind
							 * to click. That reasoning does not hold under
							 * `shellChrome: "topbar"`, where the toggle sits in the title
							 * bar and is never hidden — and the cost was that collapsing
							 * resurrected the removed rail, cropped to 48px, which reads
							 * exactly like a rendering glitch dragging the old sidebar
							 * back into a skin that deleted it. `sidebarCollapse` is what
							 * decides now, so a skin with no rail cannot grow one.
							 */}
							{(sidebarRail || (isCollapsed && sidebarCollapse === "rail")) && (
								<DashboardSidebarRail showDivider={panelOpen && !isCollapsed} />
							)}
							{panelOpen && !isCollapsed ? (
								<div
									className={cn(
										"flex h-full min-w-0 flex-1 flex-col",
										/*
										 * The SAME surface the pane cards paint. It used to be
										 * `bg-muted/35` over the well, which is a few values
										 * darker — enough to read as an accident rather than a
										 * choice.
										 */
										sidebarSurface === "card"
											? "bg-[var(--gs-pane-surface,var(--muted))]"
											: "bg-muted/45 dark:bg-muted/35",
										/*
										 * The right border goes with the card treatment. It was
										 * one of the "light grey lines": with a recessed trough
										 * beside it, a 1px rule is a second boundary drawn over
										 * the one the trough already makes.
										 */
										/*
										 * No border on the card. The trough beside it already
										 * marks the edge, and a hairline on top of that is the
										 * "vertical line down the right of the sidebar" that
										 * broke the rounded corner.
										 */
										sidebarSurface === "card"
											? "overflow-hidden rounded-[var(--gs-pane-radius,0px)] shadow-[var(--gs-pane-shadow,none)]"
											: "border-r border-border",
									)}
								>
									{sidebarNav === "text" ? (
										<>
											{/*
											 * The brand row is the sidebar's only under
											 * `shellChrome: "sidebar"`. The other skin has it in
											 * the title bar, and drawing it in both places would
											 * print the version twice, twelve pixels apart.
											 */}
											{shellChrome === "sidebar" ? (
												<DashboardSidebarBrand />
											) : null}
											<DashboardSidebarNav workspaceCount={workspaceCount} />
										</>
									) : null}
									<DashboardSidebarHeader
										isCollapsed={isCollapsed}
										panel={
											activePanel === "workspaces" ? "workspaces" : "other"
										}
									/>

									{activePanel === "sessions" ? (
										<SidebarSessionsPanel
											onOpenSession={openSessionFromSidebar}
											onResumeInTerminal={resumeInTerminalFromSidebar}
										/>
									) : (
										<>
											<div className="flex-1 overflow-y-auto hide-scrollbar">
												{showSkeleton ? <DashboardSidebarSkeleton /> : null}
												{!showSkeleton && orderedGroups.length === 0 ? (
													<div className="px-5 py-8 text-sm text-muted-foreground">
														<p>No workspaces to show yet.</p>
														<button
															type="button"
															className="mt-3 text-foreground underline underline-offset-4"
															onClick={() => navigate({ to: "/v2-workspaces" })}
														>
															Browse workspaces
														</button>
													</div>
												) : null}
												<DndContext
													sensors={sensors}
													collisionDetection={closestCenter}
													measuring={{
														droppable: { strategy: MeasuringStrategy.Always },
													}}
													onDragStart={({ active }) => {
														const project = groups.find(
															(p) => p.id === active.id,
														);
														setActiveProject(project ?? null);
													}}
													onDragEnd={handleDragEnd}
													onDragCancel={() => setActiveProject(null)}
												>
													<SortableContext
														items={projectOrder}
														strategy={verticalListSortingStrategy}
													>
														{orderedGroups.map((project) => (
															<SortableProjectWrapper
																key={project.id}
																project={project}
																isCollapsed={isCollapsed}
																isDraggingProject={activeProject != null}
																workspaceShortcutLabels={
																	workspaceShortcutLabels
																}
																onWorkspaceHover={refreshWorkspacePullRequest}
																onToggleCollapse={toggleProjectCollapsed}
															/>
														))}
													</SortableContext>

													{createPortal(
														<DragOverlay dropAnimation={null}>
															{activeProject && (
																<div className="bg-background shadow-lg border-b border-border">
																	<DashboardSidebarProjectSection
																		project={activeProject}
																		isSidebarCollapsed={isCollapsed}
																		isDraggingProject
																		workspaceShortcutLabels={
																			workspaceShortcutLabels
																		}
																		onWorkspaceHover={() => {}}
																		onToggleCollapse={() => {}}
																	/>
																</div>
															)}
														</DragOverlay>,
														document.body,
													)}
												</DndContext>
											</div>
											{!isCollapsed && !inlineWorkspacePortsEnabled && (
												<DashboardSidebarPortsList />
											)}
											{!isCollapsed && activeV2Project && activeHostUrl && (
												<V2SetupScriptCard
													hostUrl={activeHostUrl}
													projectId={activeV2Project.id}
													projectName={activeV2Project.name}
												/>
											)}
										</>
									)}
									{/*
									 * Pinned footer. `mt-auto` rather than a fixed height, so
									 * it stays at the bottom whatever the tree above does —
									 * including an empty workspace list, where a
									 * bottom-anchored account would otherwise float
									 * mid-sidebar.
									 */}
									{accountPlacement === "sidebar-footer" && !isCollapsed ? (
										<div className="mt-auto shrink-0 border-border border-t p-2">
											{sidebarFooterRows ? (
												<>
													<DashboardSidebarUsageBar />
													<DashboardSidebarAccountRow />
												</>
											) : (
												<OrganizationDropdown variant="expanded" />
											)}
										</div>
									) : null}
								</div>
							) : null}
						</div>
					</DashboardSidebarHoverCardOverlay>
				</DashboardSidebarPortsProvider>
			</DashboardSidebarHoverProvider>
		</DashboardSidebarSectionRenameProvider>
	);
}
