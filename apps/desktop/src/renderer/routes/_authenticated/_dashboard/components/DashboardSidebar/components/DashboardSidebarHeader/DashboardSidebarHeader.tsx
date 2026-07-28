import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@superset/ui/dropdown-menu";
import { toast } from "@superset/ui/sonner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@superset/ui/tooltip";
import { cn } from "@superset/ui/utils";
import { useMatchRoute, useNavigate, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { HiMiniPlus } from "react-icons/hi2";
import {
	LuFolderInput,
	LuFolderPlus,
	LuGauge,
	LuHistory,
	LuLayers,
	LuLayoutTemplate,
	LuPlus,
} from "react-icons/lu";
import { STROKE_WIDTH_THICK } from "renderer/components/WorkspaceSidebar/constants";
import { ZoomStable } from "renderer/components/ZoomStable";
import { useZoomFactor } from "renderer/hooks/useZoomFactor";
import { useHotkeyDisplay } from "renderer/hotkeys";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { useFolderFirstImport } from "renderer/routes/_authenticated/_dashboard/components/AddRepositoryModals/hooks/useFolderFirstImport";
import { NavigationControls } from "renderer/routes/_authenticated/_dashboard/components/NavigationControls";
import { SidebarToggle } from "renderer/routes/_authenticated/_dashboard/components/SidebarToggle";
import { OrganizationDropdown } from "renderer/routes/_authenticated/_dashboard/components/TopBar/components/OrganizationDropdown";
import { ResourceConsumption } from "renderer/routes/_authenticated/_dashboard/components/TopBar/components/ResourceConsumption";
import { UsageDialog } from "renderer/routes/_authenticated/_dashboard/components/UsageDialog/UsageDialog";
import { useCollections } from "renderer/routes/_authenticated/providers/CollectionsProvider";
import {
	useOpenNewProjectModal,
	useOpenTemplateGalleryModal,
} from "renderer/stores/add-repository-modal";
import { useOpenNewWorkspaceModal } from "renderer/stores/new-workspace-modal";
import { openSessionsPaneInWorkspace } from "renderer/stores/workspace-creates/openSessionsPaneInWorkspace";

interface DashboardSidebarHeaderProps {
	/**
	 * The nav rows moved to the icon rail, so the header is normally just the
	 * account row. "workspaces" additionally shows New Workspace, which belongs
	 * to that panel rather than to the chrome.
	 */
	panel?: "workspaces" | "other";
	isCollapsed?: boolean;
}

export function DashboardSidebarHeader({
	isCollapsed = false,
	panel = "workspaces",
}: DashboardSidebarHeaderProps) {
	const openModal = useOpenNewWorkspaceModal();
	const openNewProject = useOpenNewProjectModal();
	const openTemplateGallery = useOpenTemplateGalleryModal();
	const navigate = useNavigate();
	const folderImport = useFolderFirstImport({
		onError: (message) => {
			toast.error(`Import failed: ${message}`);
		},
		onMultipleProjects: ({ candidates }) => {
			toast.error("Import failed", {
				description: `Multiple projects use this repository (${candidates.length}). Choose the project in settings to set it up on this device.`,
				action: {
					label: "Open Projects",
					onClick: () => navigate({ to: "/settings/projects" }),
				},
			});
		},
	});

	const handleImportFolder = async () => {
		const result = await folderImport.start();
		if (result) {
			toast.success("Project ready — open it from the sidebar.");
		}
	};

	const shortcutText = useHotkeyDisplay("NEW_WORKSPACE").text;
	const { data: platform } = electronTrpc.window.getPlatform.useQuery();
	// Default to Mac while loading so we don't briefly cover the traffic lights.
	const isMac = platform === undefined || platform === "darwin";
	const zoomFactor = useZoomFactor();
	const matchRoute = useMatchRoute();
	const isWorkspacesListOpen = !!matchRoute({ to: "/v2-workspaces" });
	const [isUsageOpen, setIsUsageOpen] = useState(false);
	const collections = useCollections();
	// Only set while a workspace route is mounted; the rail also renders above
	// the workspace list, where there's nothing to open a pane in.
	const { workspaceId: activeWorkspaceId } = useParams({ strict: false }) as {
		workspaceId?: string;
	};

	const handleWorkspacesClick = () => {
		navigate({ to: "/v2-workspaces" });
	};

	const handleUsageClick = () => {
		setIsUsageOpen(true);
	};

	// Recent sessions opens INSIDE the workspace rather than as a rail dialog:
	// the list decides whether a session can be plain-resumed by checking the
	// host's terminal bindings, which only exist in workspace context. A
	// standalone panel here would lose that and could offer a resume for a
	// session a terminal is holding — two writers, destroyed transcript.
	const handleSessionsClick = () => {
		if (!activeWorkspaceId) {
			navigate({ to: "/v2-workspaces" });
			return;
		}
		if (openSessionsPaneInWorkspace(collections, activeWorkspaceId)) return;
		navigate({ to: "/v2-workspaces" });
	};

	if (isCollapsed) {
		return (
			<div className="flex flex-col items-center gap-2 border-b border-border/45 py-2">
				<UsageDialog open={isUsageOpen} onOpenChange={setIsUsageOpen} />
				<OrganizationDropdown variant="collapsed" />

				<Tooltip delayDuration={300}>
					<TooltipTrigger asChild>
						<button
							type="button"
							onClick={handleWorkspacesClick}
							className={cn(
								"flex size-8 items-center justify-center rounded-md transition-colors",
								isWorkspacesListOpen
									? "bg-accent text-foreground"
									: "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
							)}
						>
							<LuLayers className="size-4" />
						</button>
					</TooltipTrigger>
					<TooltipContent side="right">Workspaces</TooltipContent>
				</Tooltip>

				<Tooltip delayDuration={300}>
					<TooltipTrigger asChild>
						<button
							type="button"
							onClick={handleSessionsClick}
							className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
						>
							<LuHistory className="size-4" />
						</button>
					</TooltipTrigger>
					<TooltipContent side="right">Recent sessions</TooltipContent>
				</Tooltip>

				<Tooltip delayDuration={300}>
					<TooltipTrigger asChild>
						<button
							type="button"
							onClick={handleUsageClick}
							className={cn(
								"flex size-8 items-center justify-center rounded-md transition-colors",
								isUsageOpen
									? "bg-accent text-foreground"
									: "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
							)}
						>
							<LuGauge className="size-4" />
						</button>
					</TooltipTrigger>
					<TooltipContent side="right">Usage</TooltipContent>
				</Tooltip>

				<Tooltip delayDuration={300}>
					<TooltipTrigger asChild>
						<button
							type="button"
							onClick={() => openModal()}
							className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
						>
							<LuPlus className="size-4" strokeWidth={STROKE_WIDTH_THICK} />
						</button>
					</TooltipTrigger>
					<TooltipContent side="right">
						New Workspace ({shortcutText})
					</TooltipContent>
				</Tooltip>

				<DropdownMenu>
					<Tooltip delayDuration={300}>
						<TooltipTrigger asChild>
							<DropdownMenuTrigger asChild>
								<button
									type="button"
									aria-label="Add repository"
									className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
								>
									<LuFolderPlus className="size-4" />
								</button>
							</DropdownMenuTrigger>
						</TooltipTrigger>
						<TooltipContent side="right">Add repository</TooltipContent>
					</Tooltip>
					<DropdownMenuContent
						align="start"
						onCloseAutoFocus={(event) => event.preventDefault()}
					>
						<DropdownMenuItem onSelect={() => openNewProject()}>
							<HiMiniPlus className="size-4" />
							Clone from URL
						</DropdownMenuItem>
						<DropdownMenuItem onSelect={handleImportFolder}>
							<LuFolderInput className="size-4" />
							Open from folder
						</DropdownMenuItem>
						<DropdownMenuItem onSelect={() => openTemplateGallery()}>
							<LuLayoutTemplate className="size-4" />
							Start from a template
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</div>
		);
	}

	return (
		<div
			className="flex flex-col gap-1 border-b border-border/45 px-2 pt-2 pb-2"
			// Pin the top inset so the traffic-light row stays a constant physical
			// distance from the window top under page zoom (see the row below).
			style={isMac ? { paddingTop: `${8 / zoomFactor}px` } : undefined}
		>
			<UsageDialog open={isUsageOpen} onOpenChange={setIsUsageOpen} />
			{/* -mx-2 cancels the parent's px-2 so this row owns the 80px traffic-light
			    inset; inset and height are counter-scaled to a constant physical size
			    so the fixed macOS traffic lights stay aligned under page zoom. On Mac
			    the control clusters below use ZoomStable so the collapse/nav icons and
			    usage badge keep a constant physical size instead of scaling with page
			    zoom and overflowing this fixed-height row. It's Mac-only because the
			    pinned row height it matches is Mac-only; elsewhere the row height (h-8)
			    scales with zoom, so the controls should scale with it. */}
			<div
				className="drag -mx-2 flex h-8 items-center gap-1.5 pr-2"
				style={
					isMac
						? {
								paddingLeft: `${80 / zoomFactor}px`,
								height: `${32 / zoomFactor}px`,
							}
						: { paddingLeft: "8px" }
				}
			>
				<ZoomStable enabled={isMac} className="flex items-center gap-1.5">
					<SidebarToggle />
					<NavigationControls />
				</ZoomStable>
				<ZoomStable enabled={isMac} className="ml-auto">
					<ResourceConsumption surface="v2" />
				</ZoomStable>
			</div>
			<OrganizationDropdown variant="expanded" />

			{panel === "workspaces" ? (
				<div className="flex items-center gap-0">
					<button
						type="button"
						onClick={() => openModal()}
						className="group flex flex-1 min-w-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
					>
						<LuPlus
							className="size-4 shrink-0"
							strokeWidth={STROKE_WIDTH_THICK}
						/>
						<span className="flex-1 truncate text-left whitespace-nowrap">
							New Workspace
						</span>
						<span
							className={cn(
								"shrink-0 text-[10px] font-mono tabular-nums text-muted-foreground/60",
								"opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100",
							)}
						>
							{shortcutText}
						</span>
					</button>
					<DropdownMenu>
						<Tooltip delayDuration={300}>
							<TooltipTrigger asChild>
								<DropdownMenuTrigger asChild>
									<button
										type="button"
										aria-label="Add repository"
										className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
									>
										<LuFolderPlus className="size-4" />
									</button>
								</DropdownMenuTrigger>
							</TooltipTrigger>
							<TooltipContent side="right">Add repository</TooltipContent>
						</Tooltip>
						<DropdownMenuContent
							align="end"
							onCloseAutoFocus={(event) => event.preventDefault()}
						>
							<DropdownMenuItem onSelect={() => openNewProject()}>
								<HiMiniPlus className="size-4" />
								Clone from URL
							</DropdownMenuItem>
							<DropdownMenuItem onSelect={handleImportFolder}>
								<LuFolderInput className="size-4" />
								Open from folder
							</DropdownMenuItem>
							<DropdownMenuItem onSelect={() => openTemplateGallery()}>
								<LuLayoutTemplate className="size-4" />
								Start from a template
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				</div>
			) : null}
		</div>
	);
}
