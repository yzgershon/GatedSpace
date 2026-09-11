import { cn } from "@superset/ui/utils";
import { useMatchRoute, useParams } from "@tanstack/react-router";
import { HiOutlineWifi } from "react-icons/hi2";
import { LuSearch } from "react-icons/lu";
import { useQuickOpenStore } from "renderer/commandPalette/ui/QuickOpen/quickOpenStore";
import { ZoomStable } from "renderer/components/ZoomStable";
import { useIsV2CloudEnabled } from "renderer/hooks/useIsV2CloudEnabled";
import { useOnlineStatus } from "renderer/hooks/useOnlineStatus";
import { useSkinTokens } from "renderer/hooks/useSkinTokens";
import { useZoomFactor } from "renderer/hooks/useZoomFactor";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { useWorkspaceSidebarStore } from "renderer/stores/workspace-sidebar-state";
import { NavigationControls } from "../NavigationControls";
import { SidebarToggle } from "../SidebarToggle";
import { AppBrandMark } from "./components/AppBrandMark";
import { OpenInMenuButton } from "./components/OpenInMenuButton";
import { OrganizationDropdown } from "./components/OrganizationDropdown";
import { ResourceConsumption } from "./components/ResourceConsumption";
import { UpdateButton } from "./components/UpdateButton";
import { V2WorkspaceOpenInButton } from "./components/V2WorkspaceOpenInButton";
import { V2WorkspaceTitle } from "./components/V2WorkspaceTitle";
import { WindowControls } from "./components/WindowControls";

export function TopBar() {
	const matchRoute = useMatchRoute();
	const { data: platform } = electronTrpc.window.getPlatform.useQuery();
	const { workspaceId } = useParams({ strict: false });
	const v2Match = matchRoute({
		to: "/v2-workspace/$workspaceId",
		fuzzy: true,
	});
	const v2WorkspaceId = v2Match !== false ? v2Match.workspaceId : null;
	const isV2WorkspaceRoute = v2WorkspaceId !== null;
	const { data: workspace } = electronTrpc.workspaces.get.useQuery(
		{ id: workspaceId ?? "" },
		{ enabled: !!workspaceId && !isV2WorkspaceRoute },
	);
	const isOnline = useOnlineStatus();
	const zoomFactor = useZoomFactor();
	const { accountPlacement, shellChrome, topBarSurface } = useSkinTokens();
	const openQuickOpenFor = useQuickOpenStore((state) => state.openFor);
	const isV2CloudEnabled = useIsV2CloudEnabled();
	const isSidebarOpen = useWorkspaceSidebarStore((s) => s.isOpen);
	const isSidebarCollapsed = useWorkspaceSidebarStore((s) => s.isCollapsed());
	// Default to Mac layout while loading to avoid overlap with traffic lights
	const isMac = platform === undefined || platform === "darwin";
	// In v2 the expanded sidebar lives outside the TopBar column, so the TopBar
	// starts to the right of it and the sidebar header hosts the traffic-light
	// pad + SidebarToggle. When the sidebar is closed or collapsed (too narrow
	// for the pad), bring the toggle and pad back into the TopBar.
	/*
	 * `shellChrome: "topbar"` keeps the chrome up here whatever the sidebar is
	 * doing. That skin drops the sidebar BELOW this bar, so the sidebar has no
	 * window corner to pad against and no top edge to host a toggle — the bar
	 * runs the full width and owns all of it.
	 */
	const sidebarHostsChrome =
		shellChrome === "sidebar" &&
		isV2CloudEnabled &&
		isSidebarOpen &&
		!isSidebarCollapsed;
	const chromeInTopBar = shellChrome === "topbar";

	// Counter-scale the inset and bar height so both stay a constant physical
	// size under page zoom, keeping the fixed macOS traffic lights aligned.
	const trafficLightInset =
		isMac && !sidebarHostsChrome ? `${80 / zoomFactor}px` : "16px";
	const barStyle = isMac ? { height: `${48 / zoomFactor}px` } : undefined;

	return (
		<div
			className={cn(
				"drag gap-2 h-12 w-full flex items-center justify-between relative",
				/*
				 * The bar's contents centre in the WHOLE band above the cards, not
				 * in the bar's own 48px box.
				 *
				 * Under a floating shell there is no line between the bar and the
				 * trough beneath it — both are the same well colour — so the space a
				 * person sees above the pane and sidebar cards is 48px of bar PLUS
				 * the 18px gutter, and its midline is at 33px, not 24px. Centring in
				 * the box put everything nine pixels high in the space it actually
				 * occupies, which reads as the whole row sitting too far up.
				 *
				 * A padding-top of one full gutter moves the content box to 18..48,
				 * whose centre is 33. The bar's OUTER height is untouched, so the
				 * cards below do not move.
				 *
				 * Derived from `--gs-pane-inset` rather than gated on the skin, which
				 * makes it self-correcting: VS Code Style sets `paneGap: 0`, so the
				 * padding evaluates to 0 and that skin's toolbar keeps centring in
				 * its own box, which is right for a bar with a fill and a rule under
				 * it and no trough at all.
				 */
				"pt-[calc(var(--gs-pane-inset,0px)*2)]",
				/*
				 * No fill and no rule under a floating shell.
				 *
				 * The bar was `bg-muted/45` with a `border-b`, which is what a
				 * toolbar looks like — and a toolbar stretched across the top of a
				 * window whose content is floating cards is the same mismatch the
				 * pane borders were. Without them the brand, the launcher, the tab
				 * rail and the window controls sit on the same ground the cards
				 * float on, and the row reads as objects rather than as a strip.
				 */
				topBarSurface === "bar" &&
					"bg-muted/45 border-b border-border dark:bg-muted/35",
			)}
			style={barStyle}
		>
			<div
				className="flex items-center h-full shrink-0"
				style={{ paddingLeft: trafficLightInset }}
			>
				{!sidebarHostsChrome &&
					(chromeInTopBar ? (
						/*
						 * Name, build, collapse, search — and nothing else.
						 *
						 * Back/forward/history are gone on purpose. This is a window
						 * full of panes, not a browser: there is no history stack worth
						 * stepping through, and the three controls were the widest thing
						 * in the corner while being the least used.
						 */
						<ZoomStable enabled={isMac} className="flex items-center gap-1.5">
							<AppBrandMark />
							<SidebarToggle />
							{isV2WorkspaceRoute && v2WorkspaceId && (
								<button
									type="button"
									aria-label="Search files"
									title="Search files"
									// size-10 and an 18px glyph, matching the sidebar toggle
									// beside it and the two surfaces across the bar. It was
									// size-9 with a 20px glyph — the only control up here that
									// was both smaller and heavier than its neighbours.
									className="no-drag flex size-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
									onClick={() =>
										openQuickOpenFor({ workspaceId: v2WorkspaceId })
									}
								>
									<LuSearch className="size-5" strokeWidth={1.5} />
								</button>
							)}
						</ZoomStable>
					) : (
						<ZoomStable enabled={isMac} className="flex items-center gap-1.5">
							<SidebarToggle />
							<NavigationControls />
							{!isV2CloudEnabled && <ResourceConsumption surface="v1" />}
						</ZoomStable>
					))}
			</div>

			{/*
			 * Centre slot for the agent presets under the Liquid Glass layout.
			 * They portal in from the workspace page so they keep that page's
			 * context (pane store, launcher, workspace providers) while appearing
			 * up here — the same trick the run button already uses.
			 *
			 * `empty:hidden` so the flex gap does not double while nothing is
			 * portaled in, which is every non-workspace route.
			 */}
			{/*
			 * The background-shells chip, on the LEFT.
			 *
			 * It used to sit beside the open-in button, where it appeared and
			 * disappeared as builds started and finished — and every time it did, it
			 * changed the width of the right-hand cluster and shifted the tab rail
			 * sideways under the cursor. A readout that moves the controls next to
			 * it is worse than one that is slightly further from them.
			 */}
			{isV2WorkspaceRoute && (
				<div
					id="workspace-topbar-shells-slot"
					className="no-drag flex shrink-0 items-center empty:hidden"
				/>
			)}
			<div
				/*
				 * `inset-0` plus the same padding, rather than leaning on the static
				 * position of an absolutely-positioned flex child. That static
				 * position DOES follow `align-items` per spec, but it is the kind of
				 * rule that is easy to break by accident and impossible to see
				 * breaking — spelling the box out costs nothing and cannot drift
				 * from the row it is supposed to line up with.
				 */
				className="no-drag pointer-events-auto absolute inset-0 mx-auto flex w-fit items-center justify-center pt-[calc(var(--gs-pane-inset,0px)*2)] empty:hidden"
				id="workspace-topbar-presets-slot"
			/>
			<div className="flex min-w-0 flex-1 items-center justify-start gap-2 pl-2">
				{isV2WorkspaceRoute && v2WorkspaceId ? (
					chromeInTopBar ? /*
					 * Nothing here any more.
					 *
					 * This slot held the breadcrumb, then the group switcher pill.
					 * The breadcrumb named the workspace you had just clicked in the
					 * sidebar next to a branch you had just chosen — two facts you
					 * already knew. The pill named the group you were already in and
					 * hid every other one behind a click.
					 *
					 * The tab rail answers both, and it lives on the far side of the
					 * presets where there is room for it to expand. Left of centre it
					 * would have grown rightward into the launcher.
					 */
					null : (
						<V2WorkspaceTitle workspaceId={v2WorkspaceId} />
					)
				) : null}
			</div>

			<div className="flex items-center gap-3 h-full pr-4 shrink-0">
				{!isOnline && (
					<div className="no-drag flex items-center gap-1.5 text-xs text-muted-foreground bg-muted px-2 py-1 rounded">
						<HiOutlineWifi className="size-3.5" />
						<span>Offline</span>
					</div>
				)}
				<UpdateButton />
				{/*
				 * Portal target for the background-shells chip (see v2-workspace
				 * page). It sits immediately before the open-in button because
				 * "something is running in this workspace" and "open this workspace
				 * in a file explorer" are the same kind of fact: about the
				 * workspace, not about whichever tab happens to be in front.
				 *
				 * empty:hidden keeps the flex gap from doubling while nothing is
				 * portaled in, which is every non-workspace route and every
				 * workspace with nothing running.
				 */}
				{/*
				 * Portal target for the tab rail.
				 *
				 * Anchored RIGHT so expanding a tab grows leftward into the empty
				 * middle instead of shoving the window controls sideways.
				 *
				 * The max-width is what stops it reaching the presets. That launcher
				 * is `absolute inset-x-0 mx-auto w-fit` on purpose — centred against
				 * the whole bar so it cannot be shifted by either side — and an
				 * absolutely positioned element does not participate in flow, so
				 * nothing here can push it out of the way. With enough groups the
				 * rail simply slid underneath it. Capping the rail and letting it
				 * scroll keeps the launcher centred AND stops the collision; the
				 * scrollbar is hidden because a visible one in a 28px rail is worse
				 * than the overflow it reports.
				 *
				 * NO `justify-end` here, and that is a bug fix rather than a taste
				 * call. In a scroll container, content that overflows a
				 * `justify-end` flex row is pushed off the START edge, and the
				 * scroll range does not extend to reach it — the first tabs become
				 * permanently unreachable rather than merely off-screen. The slot
				 * already sits on the right because the cluster around it does; it
				 * does not need to align its own contents there too.
				 *
				 * `vw`, NOT `%`. A percentage max-width resolves against the
				 * CONTAINING BLOCK, which here is the small right-hand cluster, not
				 * the window — so `34%` came out around 100px and sliced a single
				 * tab in half. The intent was always "about a third of the window",
				 * and only a viewport unit says that.
				 *
				 * It is an inline style rather than a Tailwind arbitrary value
				 * because this cap is the only thing standing between the rail and
				 * the centred launcher, and this repo has shipped three builds where
				 * a class Tailwind never emitted left the markup correct and the rule
				 * absent. A style attribute cannot be scanned away.
				 */}
				{isV2WorkspaceRoute && (
					<div
						id="workspace-topbar-tabs-slot"
						className="no-drag flex min-w-0 items-center overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] empty:hidden [&::-webkit-scrollbar]:hidden"
						style={{ maxWidth: "30vw" }}
					/>
				)}
				{/*
				 * Open in moved into the pane header's ⋯ menu under this chrome.
				 *
				 * It is the widest control in the corner and it answers a question
				 * about the FOLDER, which the pane menu already covers alongside
				 * "Copy working directory" and "Reveal in File Explorer". Moving it
				 * is what buys the rail its room. VS Code Style keeps it here,
				 * because that skin has no rail competing for the space.
				 */}
				{isV2WorkspaceRoute ? (
					chromeInTopBar ? null : (
						<V2WorkspaceOpenInButton workspaceId={v2WorkspaceId} />
					)
				) : workspace?.worktreePath ? (
					<OpenInMenuButton
						worktreePath={workspace.worktreePath}
						branch={workspace.worktree?.branch}
						projectId={workspace.project?.id}
					/>
				) : null}
				{/*
				 * Liquid Glass moves the account to the sidebar footer, so the top
				 * bar's right cluster is only actions.
				 */}
				{!isV2CloudEnabled && accountPlacement === "topbar" && (
					<OrganizationDropdown />
				)}
				{/*
				 * Hidden entirely unless the sidebar is enabled — a toggle for a
				 * panel that cannot open is worse than no toggle at all.
				 */}
				{!isMac && <WindowControls />}
			</div>
		</div>
	);
}
