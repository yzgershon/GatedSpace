import { cn } from "@superset/ui/utils";
import {
	createFileRoute,
	Outlet,
	useMatchRoute,
	useNavigate,
} from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { CommandPaletteHost } from "renderer/commandPalette";
import { ClaudeAccountSwapHost } from "renderer/components/ClaudeAccountSwap";
import { ResizablePanel } from "renderer/components/ResizablePanel";
import { DeleteWorkspaceDialog } from "renderer/components/WorkspaceSidebar/WorkspaceListItem/components";
import { useIsV2CloudEnabled } from "renderer/hooks/useIsV2CloudEnabled";
import { useSkinTokens } from "renderer/hooks/useSkinTokens";
import { useHotkey } from "renderer/hotkeys";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { DashboardSidebar } from "renderer/routes/_authenticated/_dashboard/components/DashboardSidebar";
import { DashboardSidebarDeleteDialog } from "renderer/routes/_authenticated/_dashboard/components/DashboardSidebar/components/DashboardSidebarDeleteDialog";
import { useDashboardSidebarState } from "renderer/routes/_authenticated/hooks/useDashboardSidebarState";
import { useDevSeedV2Sidebar } from "renderer/routes/_authenticated/hooks/useDevSeedV2Sidebar";
import { useHostWorkspaces } from "renderer/routes/_authenticated/providers/HostWorkspacesProvider";
import { getLastSettingsRoute } from "renderer/stores/last-settings-route";
import { useOpenNewWorkspaceModal } from "renderer/stores/new-workspace-modal";
import { useUiScaleStore, zoomStyle } from "renderer/stores/ui-scale";
import {
	COLLAPSED_WORKSPACE_SIDEBAR_WIDTH,
	DEFAULT_WORKSPACE_SIDEBAR_WIDTH,
	MAX_WORKSPACE_SIDEBAR_WIDTH,
	useWorkspaceSidebarStore,
} from "renderer/stores/workspace-sidebar-state";
import { AddRepositoryModals } from "./components/AddRepositoryModals";
import { CrossVersionMismatchState } from "./components/CrossVersionMismatchState";
import { TopBar } from "./components/TopBar";

export const Route = createFileRoute("/_authenticated/_dashboard")({
	component: DashboardLayout,
});

type DeleteTarget =
	| {
			version: "v1";
			workspaceId: string;
			workspaceName: string;
			workspaceType: "worktree" | "branch";
	  }
	| {
			version: "v2";
			workspaceId: string;
			workspaceName: string;
			open: boolean;
	  };

function DashboardLayout() {
	const navigate = useNavigate();
	const openNewWorkspaceModal = useOpenNewWorkspaceModal();
	const isV2CloudEnabled = useIsV2CloudEnabled();
	const { workspaces: hostWorkspaces } = useHostWorkspaces();
	const { removeWorkspaceFromSidebar } = useDashboardSidebarState();
	useDevSeedV2Sidebar();
	// Get current workspace from route to pre-select project in new workspace modal
	const matchRoute = useMatchRoute();
	const currentWorkspaceMatch = matchRoute({
		to: "/workspace/$workspaceId",
		fuzzy: true,
	});
	const currentWorkspaceId =
		currentWorkspaceMatch !== false ? currentWorkspaceMatch.workspaceId : null;
	const v2WorkspaceMatch = matchRoute({
		to: "/v2-workspace/$workspaceId",
		fuzzy: true,
	});
	const currentV2WorkspaceId =
		v2WorkspaceMatch !== false ? v2WorkspaceMatch.workspaceId : null;
	const onV1WorkspaceRoute = currentWorkspaceMatch !== false;
	const onV2WorkspaceRoute = v2WorkspaceMatch !== false;
	const versionMismatch =
		(isV2CloudEnabled && onV1WorkspaceRoute) ||
		(!isV2CloudEnabled && onV2WorkspaceRoute);

	const { data: currentWorkspace } = electronTrpc.workspaces.get.useQuery(
		{ id: currentWorkspaceId ?? "" },
		{ enabled: !!currentWorkspaceId },
	);

	const currentV2Workspace = useMemo(
		() =>
			currentV2WorkspaceId != null
				? (hostWorkspaces.find(
						(workspace) => workspace.id === currentV2WorkspaceId,
					) ?? null)
				: null,
		[hostWorkspaces, currentV2WorkspaceId],
	);

	const {
		isOpen: isWorkspaceSidebarOpen,
		toggleCollapsed: toggleWorkspaceSidebarCollapsed,
		setOpen: setWorkspaceSidebarOpen,
		width: workspaceSidebarWidth,
		setWidth: setWorkspaceSidebarWidth,
		isResizing: isWorkspaceSidebarResizing,
		setIsResizing: setWorkspaceSidebarIsResizing,
		isCollapsed: isWorkspaceSidebarCollapsed,
	} = useWorkspaceSidebarStore();

	// Global hotkeys for dashboard
	useHotkey("OPEN_SETTINGS", () => navigate({ to: getLastSettingsRoute() }));
	useHotkey("SHOW_HOTKEYS", () => navigate({ to: "/settings/keyboard" }));
	useHotkey("TOGGLE_WORKSPACE_SIDEBAR", () => {
		if (!isWorkspaceSidebarOpen) {
			setWorkspaceSidebarOpen(true);
		} else {
			toggleWorkspaceSidebarCollapsed();
		}
	});
	useHotkey("NEW_WORKSPACE", () =>
		openNewWorkspaceModal(currentWorkspace?.projectId),
	);

	const mainScale = useUiScaleStore((state) => state.mainScale);
	const sidebarScale = useUiScaleStore((state) => state.sidebarScale);
	const mainZoom = zoomStyle(mainScale);
	const sidebarZoom = zoomStyle(sidebarScale);
	/*
	 * The trough around the sidebar card, in the sidebar's OWN zoomed pixels.
	 *
	 * The sidebar and the main area zoom independently on purpose, and CSS
	 * `zoom` scales padding along with everything else — so an 18px gutter
	 * declared inside the sidebar renders at 18 × sidebarScale while the same
	 * 18px around the panes renders at 18 × mainScale. Any difference between
	 * the two scales pushes the sidebar card's top and bottom edges off the
	 * pane cards' by exactly that ratio, which is what "the sidebar is shorter
	 * at the top and the bottom than the panes" is.
	 *
	 * Dividing by the sidebar's own zoom cancels it, leaving the same PHYSICAL
	 * gutter the panes get. It is done in JS rather than CSS because both scales
	 * already live here as numbers, and a `calc()` chain reading two custom
	 * properties would be harder to read than the one division it stands for.
	 */
	const sidebarGutterScale = mainScale / sidebarScale;
	const sidebarCardVars = {
		...sidebarZoom,
		"--gs-sidebar-gutter-y": `calc(var(--gs-pane-inset, 0px) * 2 * ${sidebarGutterScale})`,
		"--gs-sidebar-gutter-x": `calc(var(--gs-pane-inset, 0px) * ${sidebarGutterScale})`,
	} as React.CSSProperties;

	const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);

	useHotkey(
		"CLOSE_WORKSPACE",
		() => {
			if (currentWorkspaceId && currentWorkspace) {
				setDeleteTarget({
					workspaceId: currentWorkspaceId,
					workspaceName: currentWorkspace.name,
					workspaceType: currentWorkspace.type,
					version: "v1",
				});
				return;
			}

			if (
				currentV2WorkspaceId &&
				currentV2Workspace &&
				currentV2Workspace.type !== "main"
			) {
				setDeleteTarget({
					workspaceId: currentV2WorkspaceId,
					workspaceName: currentV2Workspace.name || currentV2Workspace.branch,
					version: "v2",
					open: true,
				});
			}
		},
		{
			enabled:
				(!!currentWorkspaceId && !!currentWorkspace) ||
				(!!currentV2WorkspaceId &&
					!!currentV2Workspace &&
					currentV2Workspace.type !== "main"),
		},
	);

	/*
	 * Always mounted, animated to zero width when closed.
	 *
	 * It used to be `isWorkspaceSidebarOpen && <ResizablePanel>`, so closing it
	 * unmounted the whole subtree — and you cannot transition an element that
	 * stops existing, which is exactly why the toggle snapped rather than slid.
	 *
	 * The inner box keeps its full width while the outer one animates, so the
	 * contents CLIP off the edge instead of re-wrapping into an ever-narrower
	 * container. Reflowing every row on each animation frame is what would make
	 * a width transition read as a stutter rather than a slide.
	 *
	 * The transition is dropped while dragging the resize handle: a 200ms ease
	 * applied to a value the pointer is already driving makes the edge lag the
	 * cursor.
	 */
	const {
		paneGap,
		paneRadius,
		paneElevated,
		shellChrome,
		sidebarCollapse,
		sidebarSurface,
		paneSurface,
	} = useSkinTokens();

	/*
	 * Collapsed, in a skin with no rail, means GONE — not a 48px empty card.
	 *
	 * `toggleCollapsed` sets the width to 48 and leaves `isOpen` true, which is
	 * right when that 48px holds the activity rail. Under Liquid Glass the rail
	 * is deleted, so the same 48px was either the old rail dragged back in
	 * (before `sidebarCollapse`) or a blank sliver of card. Neither is a
	 * collapsed sidebar. The toggle lives in the title bar under that chrome, so
	 * there is still a way back.
	 */
	const sidebarCollapsedAway =
		sidebarCollapse === "hidden" && isWorkspaceSidebarCollapsed();

	/*
	 * Shared card geometry, set once for the whole shell. The workspace route
	 * sets these again on its own container along with the pane-only values;
	 * re-declaring the same numbers on a descendant is a no-op.
	 */
	const shellChromeVars = {
		/*
		 * The card surface, published at the SHELL level so the sidebar paints
		 * exactly what the panes paint.
		 *
		 * The sidebar was `bg-muted/35` over the well, which lands near #171413 —
		 * a few values darker than the panes' #1c1a18. Small enough to look like
		 * a rendering difference rather than a decision, which is how it was
		 * reported: "the sidebar is a tiny bit darker".
		 *
		 * Declared here rather than reused from the workspace page because the
		 * sidebar is a SIBLING of the outlet and never sees that page's variables.
		 * Custom properties are substituted where they are declared, so this
		 * resolves against the app's own `--background` and inherits down as a
		 * literal colour.
		 */
		"--gs-pane-surface":
			paneSurface === "raised"
				? "color-mix(in oklab, var(--background) 42%, var(--card))"
				: "var(--background)",
		"--gs-pane-inset": `${paneGap / 2}px`,
		"--gs-pane-radius": `${paneRadius}px`,
		"--gs-pane-shadow": paneElevated
			? "0 8px 26px -12px rgb(0 0 0 / 0.7)"
			: "none",
		"--gs-pane-well": paneElevated
			? "color-mix(in oklab, var(--background) 62%, black)"
			: "var(--background)",
		/*
		 * The 1px rule between two split panes.
		 *
		 * `ResizableHandle` paints `bg-border` by default, so every split drew a
		 * grey line down the middle of the gutter. With an 18px gap already
		 * separating the cards that is two boundaries for one edge, and it is what
		 * kept the panes reading as tiles rather than as floating cards. It stays
		 * draggable and returns on hover.
		 */
		"--gs-split-handle": paneElevated ? "transparent" : "var(--border)",
	} as React.CSSProperties;

	const sidebarPanel = (
		<ResizablePanel
			width={workspaceSidebarWidth}
			onWidthChange={setWorkspaceSidebarWidth}
			isResizing={isWorkspaceSidebarResizing}
			onResizingChange={setWorkspaceSidebarIsResizing}
			minWidth={COLLAPSED_WORKSPACE_SIDEBAR_WIDTH}
			maxWidth={MAX_WORKSPACE_SIDEBAR_WIDTH}
			handleSide="right"
			// A card does not want a full-height rule down its edge; the trough
			// beside it already marks the boundary.
			bordered={sidebarSurface !== "card"}
			clampWidth={false}
			onDoubleClickHandle={() =>
				setWorkspaceSidebarWidth(DEFAULT_WORKSPACE_SIDEBAR_WIDTH)
			}
		>
			{/*
			 * The zoom goes ON the sidebar's own root, not on a wrapper around it.
			 * A wrapper is an extra flex box between the resizable panel and a
			 * child that already sets `flex h-full`, and it cropped the rail and
			 * fought the drag handle. Passing a style down adds no layout box.
			 */}
			<DashboardSidebar
				isCollapsed={isWorkspaceSidebarCollapsed()}
				style={sidebarCardVars}
			/>
		</ResizablePanel>
	);

	const animatedSidebar = (
		<div
			aria-hidden={!isWorkspaceSidebarOpen || sidebarCollapsedAway}
			className={cn(
				"h-full shrink-0 overflow-hidden",
				!isWorkspaceSidebarResizing &&
					"transition-[width] duration-200 ease-out",
			)}
			style={{
				width:
					isWorkspaceSidebarOpen && !sidebarCollapsedAway
						? workspaceSidebarWidth
						: 0,
			}}
		>
			<div className="h-full" style={{ width: workspaceSidebarWidth }}>
				{sidebarPanel}
			</div>
		</div>
	);

	/*
	 * Only lift the sidebar out of the TopBar column when v2 + expanded.
	 * Collapsed/closed sidebars stay inside so the TopBar runs full-width.
	 *
	 * `shellChrome: "topbar"` never lifts it. A full-height sidebar starts at
	 * the top of the WINDOW while the panes start below the top bar, so the
	 * sidebar card and the pane cards are offset by the bar's height and read
	 * as two separate systems — which is exactly the misalignment the card
	 * layout is supposed to remove. Below the bar they share a top edge.
	 */
	const sidebarOutsideColumn =
		shellChrome === "sidebar" &&
		isV2CloudEnabled &&
		isWorkspaceSidebarOpen &&
		!isWorkspaceSidebarCollapsed();

	return (
		/*
		 * The app's ground, and the reason it is set HERE rather than on the
		 * workspace route: the sidebar is a sibling of the outlet, so a well
		 * defined inside the workspace page could never reach behind it. With the
		 * well only on the pane container the sidebar card would have floated on
		 * `--background` while the panes floated on something darker, and the two
		 * troughs would not have matched.
		 *
		 * The geometry travels with it for the same reason: the sidebar reads
		 * `--gs-pane-inset` and `--gs-pane-radius` to match the cards beside it.
		 */
		<div
			className="flex h-full w-full overflow-hidden bg-[var(--gs-pane-well,var(--background))]"
			style={shellChromeVars}
		>
			<CommandPaletteHost />
			{/*
			 * The one account picker. Mounted here, beside the palette, for the same
			 * reason: `/swap` is typed in panes and terminals that have no dialog of
			 * their own, and there must be exactly one of these — a second copy is
			 * how "switching accounts" became several things with one name.
			 */}
			<ClaudeAccountSwapHost />
			{sidebarOutsideColumn && animatedSidebar}
			<div className="flex flex-1 flex-col min-w-0 min-h-0">
				{/*
				 * The main scale is applied to the top bar and the outlet
				 * INDIVIDUALLY rather than to the column that holds them, because
				 * the sidebar renders inside that column when it isn't lifted out —
				 * zooming the column would multiply the sidebar's own scale by this
				 * one. See renderer/stores/ui-scale.
				 */}
				<div style={mainZoom}>
					<TopBar />
				</div>
				<div className="flex flex-1 min-h-0 min-w-0 overflow-hidden">
					{!sidebarOutsideColumn && animatedSidebar}
					<div style={mainZoom} className="flex flex-1 min-h-0 min-w-0">
						{versionMismatch ? <CrossVersionMismatchState /> : <Outlet />}
					</div>
				</div>
			</div>
			<AddRepositoryModals />
			{deleteTarget?.version === "v1" && (
				<DeleteWorkspaceDialog
					workspaceId={deleteTarget.workspaceId}
					workspaceName={deleteTarget.workspaceName}
					workspaceType={deleteTarget.workspaceType}
					open={true}
					onOpenChange={(open) => {
						if (!open) setDeleteTarget(null);
					}}
				/>
			)}
			{deleteTarget?.version === "v2" && (
				<DashboardSidebarDeleteDialog
					workspaceId={deleteTarget.workspaceId}
					workspaceName={deleteTarget.workspaceName}
					open={deleteTarget.open}
					onOpenChange={(open) => {
						setDeleteTarget((target) =>
							target?.version === "v2" ? { ...target, open } : target,
						);
					}}
					onDeleted={() => {
						removeWorkspaceFromSidebar(deleteTarget.workspaceId);
						setDeleteTarget(null);
					}}
				/>
			)}
		</div>
	);
}
