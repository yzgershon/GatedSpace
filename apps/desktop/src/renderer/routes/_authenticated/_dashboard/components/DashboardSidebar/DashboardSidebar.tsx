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
import { useMatchRoute, useNavigate, useParams } from "@tanstack/react-router";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { getHostTrpcClient } from "renderer/lib/host-trpc-client";
import {
	DEFAULT_COLS,
	DEFAULT_ROWS,
} from "renderer/lib/terminal/terminal-runtime";
import { useDashboardSidebarState } from "renderer/routes/_authenticated/hooks/useDashboardSidebarState";
import { useCollections } from "renderer/routes/_authenticated/providers/CollectionsProvider";
import { useLocalHostService } from "renderer/routes/_authenticated/providers/LocalHostServiceProvider";
import { useInlineWorkspacePortsEnabled } from "renderer/stores/inline-workspace-ports";
import { useSidebarPanelStore } from "renderer/stores/sidebar-panel";
import { openSessionInWorkspace } from "renderer/stores/workspace-creates/openSessionInWorkspace";
import { openTerminalInWorkspace } from "renderer/stores/workspace-creates/openTerminalInWorkspace";
import { DashboardSidebarHeader } from "./components/DashboardSidebarHeader";
import { DashboardSidebarHoverCardOverlay } from "./components/DashboardSidebarHoverCardOverlay";
import { SidebarSessionsPanel } from "./components/DashboardSidebarPanels";
import { DashboardSidebarPortsList } from "./components/DashboardSidebarPortsList";
import { DashboardSidebarProjectSection } from "./components/DashboardSidebarProjectSection";
import { DashboardSidebarRail } from "./components/DashboardSidebarRail";
import { DashboardSidebarSectionRenameProvider } from "./components/DashboardSidebarSectionRenameContext";
import { DashboardSidebarSkeleton } from "./components/DashboardSidebarSkeleton";
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
			className="border-b border-border/45 last:border-b-0"
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
			sessionId: string;
			cwd: string | null;
			title: string;
			mode: "resume" | "fork";
		}) => {
			if (
				activeWorkspaceId &&
				openSessionInWorkspace(collections, activeWorkspaceId, {
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
		return projectOrder
			.map((id) => byId.get(id))
			.filter((g): g is DashboardSidebarProject => g != null);
	}, [groups, projectOrder]);

	const workspaceShortcutLabels = useDashboardSidebarShortcuts(orderedGroups);

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
						<div className="flex h-full" style={style}>
							{/*
							 * Collapsed means "the rail IS the sidebar". Previously only
							 * the width changed, so the panel kept rendering into whatever
							 * pixels were left and got squeezed into an unreadable strip.
							 */}
							<DashboardSidebarRail showDivider={panelOpen && !isCollapsed} />
							{panelOpen && !isCollapsed ? (
								<div className="flex h-full min-w-0 flex-1 flex-col border-r border-border bg-muted/45 dark:bg-muted/35">
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
											onNewSession={() => navigate({ to: "/v2-workspaces" })}
										/>
									) : (
										<>
											<div className="flex-1 overflow-y-auto hide-scrollbar">
												{showSkeleton ? <DashboardSidebarSkeleton /> : null}
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
								</div>
							) : null}
						</div>
					</DashboardSidebarHoverCardOverlay>
				</DashboardSidebarPortsProvider>
			</DashboardSidebarHoverProvider>
		</DashboardSidebarSectionRenameProvider>
	);
}
