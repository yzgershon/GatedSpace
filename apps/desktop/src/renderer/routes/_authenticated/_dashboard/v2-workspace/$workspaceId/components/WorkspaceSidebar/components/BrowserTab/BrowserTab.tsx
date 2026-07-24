import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@superset/ui/dropdown-menu";
import { cn } from "@superset/ui/utils";
import { useQuery } from "@tanstack/react-query";
import {
	Check,
	ChevronDown,
	ExternalLink,
	Globe,
	LoaderCircle,
	Maximize2,
	Minimize2,
	Monitor,
	RotateCw,
	Smartphone,
} from "lucide-react";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useWorkspaceHostUrl } from "renderer/hooks/host-service/useWorkspaceHostUrl";
import { getHostServiceClientByUrl } from "renderer/lib/host-service-client";
import {
	type BrowserRuntimeViewport,
	browserRuntimeRegistry,
} from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/BrowserPane/browserRuntimeRegistry";
import { usePersistentWebview } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/BrowserPane/hooks/usePersistentWebview";

/**
 * Right-sidebar Browser tab: a full embedded browser hosted in the sidebar,
 * driven by the same webview runtime as browser panes (persisted logins,
 * DevTools, history). Adds device-viewport emulation (mobile/desktop) and a
 * pop-out into a full-width pane, since a sidebar column is narrow.
 */

type ViewportId = "mobile" | "desktop";

const VIEWPORTS: Record<
	ViewportId,
	{ label: string; icon: typeof Smartphone; runtime: BrowserRuntimeViewport }
> = {
	mobile: {
		label: "Mobile",
		icon: Smartphone,
		runtime: { contentWidth: 375, center: true },
	},
	desktop: {
		label: "Desktop",
		icon: Monitor,
		runtime: { contentWidth: 1280, center: false },
	},
};

/** One persistent runtime entry per workspace, distinct from any pane id. */
function sidebarBrowserPaneId(workspaceId: string): string {
	return `sidebar-browser:${workspaceId}`;
}

function useBrowserState(paneId: string) {
	return useSyncExternalStore(
		useCallback(
			(cb) => browserRuntimeRegistry.onStateChange(paneId, cb),
			[paneId],
		),
		useCallback(() => browserRuntimeRegistry.getState(paneId), [paneId]),
	);
}

interface PreviewPort {
	port: number;
	label: string | null;
	url: string;
}

/**
 * Dev-server ports detected for this workspace, offered as quick-nav targets in
 * the address bar. Salvaged from the retired Preview tab so "start a dev server,
 * open it here" still works with one click. Light polling; local reads only.
 */
function usePreviewPorts(workspaceId: string): PreviewPort[] {
	const hostUrl = useWorkspaceHostUrl(workspaceId);
	const { data } = useQuery({
		queryKey: ["sidebar-browser-ports", hostUrl, workspaceId],
		enabled: Boolean(hostUrl),
		refetchInterval: 5_000,
		queryFn: async (): Promise<PreviewPort[]> => {
			if (!hostUrl) return [];
			const client = getHostServiceClientByUrl(hostUrl);
			const ports = await client.ports.getAll.query({
				workspaceIds: [workspaceId],
			});
			return ports
				.map((port) => ({
					port: port.port,
					label: port.label,
					url: `http://localhost:${port.port}`,
				}))
				.sort((a, b) => a.port - b.port);
		},
	});
	return data ?? [];
}

interface BrowserTabProps {
	workspaceId: string;
	/** Pop the current page out into a full browser pane in the workspace. */
	onOpenBrowserUrl?: (url: string) => void;
	/** Whether the sidebar is currently in wide mode. */
	isWide?: boolean;
	/** Toggle the sidebar between its normal width and wide. */
	onToggleWide?: () => void;
}

export function BrowserTab({
	workspaceId,
	onOpenBrowserUrl,
	isWide,
	onToggleWide,
}: BrowserTabProps) {
	const paneId = sidebarBrowserPaneId(workspaceId);
	const state = useBrowserState(paneId);
	const { placeholderRef, reload, navigateTo } = usePersistentWebview({
		paneId,
		initialUrl: "about:blank",
		onOpenUrl: onOpenBrowserUrl,
	});

	const [viewport, setViewport] = useState<ViewportId>("mobile");
	// Apply the viewport to the runtime after the webview has attached (the
	// attach effect in usePersistentWebview runs before this one on mount).
	useEffect(() => {
		browserRuntimeRegistry.setViewport(paneId, VIEWPORTS[viewport].runtime);
	}, [paneId, viewport]);

	const ports = usePreviewPorts(workspaceId);

	const [draft, setDraft] = useState("");
	const [isEditing, setIsEditing] = useState(false);
	const isBlankPage = !state.currentUrl || state.currentUrl === "about:blank";
	const displayUrl = isBlankPage ? "" : state.currentUrl.replace(/\/$/, "");

	const ActiveViewportIcon = VIEWPORTS[viewport].icon;

	const submit = () => {
		const trimmed = draft.trim();
		if (trimmed) navigateTo(trimmed);
		setIsEditing(false);
	};

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="flex h-9 shrink-0 items-center gap-1 border-b border-border px-1.5">
				{/* Viewport (mobile / desktop) */}
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<button
							type="button"
							className="flex h-[26px] shrink-0 items-center gap-1 rounded-md border border-border bg-tertiary px-1.5 text-[11px] text-foreground transition-colors hover:bg-accent/60"
						>
							<ActiveViewportIcon className="size-3" />
							<span>{VIEWPORTS[viewport].label}</span>
							<ChevronDown className="size-3 text-muted-foreground" />
						</button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="start" className="min-w-32">
						{(Object.keys(VIEWPORTS) as ViewportId[]).map((id) => {
							const Icon = VIEWPORTS[id].icon;
							return (
								<DropdownMenuItem
									key={id}
									onSelect={() => setViewport(id)}
									className="gap-2"
								>
									<Icon className="size-3.5" />
									<span className="flex-1">{VIEWPORTS[id].label}</span>
									{viewport === id && (
										<Check className="size-3.5 text-primary" />
									)}
								</DropdownMenuItem>
							);
						})}
					</DropdownMenuContent>
				</DropdownMenu>

				{/* Reload */}
				<button
					type="button"
					onClick={reload}
					aria-label="Reload"
					className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-accent/60 hover:text-foreground"
				>
					{state.isLoading ? (
						<LoaderCircle className="size-3.5 animate-spin" />
					) : (
						<RotateCw className="size-3.5" />
					)}
				</button>

				{/* Address bar (+ detected dev servers) */}
				<div className="flex h-[26px] min-w-0 flex-1 items-center gap-1 rounded-md border border-border bg-tertiary pl-2 pr-1">
					<form
						className="flex min-w-0 flex-1 items-center"
						onSubmit={(e) => {
							e.preventDefault();
							submit();
						}}
					>
						<input
							value={isEditing ? draft : displayUrl}
							onFocus={() => {
								setDraft(displayUrl);
								setIsEditing(true);
							}}
							onChange={(e) => setDraft(e.target.value)}
							onBlur={() => setIsEditing(false)}
							placeholder="Enter URL or search…"
							spellCheck={false}
							autoComplete="off"
							className="h-full w-full min-w-0 bg-transparent text-[11.5px] text-foreground outline-none placeholder:text-muted-foreground/40"
						/>
					</form>
					{ports.length > 0 && (
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<button
									type="button"
									aria-label="Detected dev servers"
									className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground/60 transition-colors hover:bg-accent/60 hover:text-foreground"
								>
									<ChevronDown className="size-3" />
								</button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end" className="min-w-48">
								{ports.map((p) => (
									<DropdownMenuItem
										key={p.port}
										onSelect={() => navigateTo(p.url)}
										className="gap-2"
									>
										<Globe className="size-3.5 text-muted-foreground" />
										<span className="flex-1 truncate">
											{p.label ?? `localhost:${p.port}`}
										</span>
										<span className="text-[10px] text-muted-foreground">
											{p.port}
										</span>
									</DropdownMenuItem>
								))}
							</DropdownMenuContent>
						</DropdownMenu>
					)}
				</div>

				{/* Wide-mode toggle */}
				{onToggleWide && (
					<button
						type="button"
						onClick={onToggleWide}
						aria-label={isWide ? "Narrow sidebar" : "Widen sidebar"}
						className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-accent/60 hover:text-foreground"
					>
						{isWide ? (
							<Minimize2 className="size-3.5" />
						) : (
							<Maximize2 className="size-3.5" />
						)}
					</button>
				)}

				{/* Pop out into a full pane */}
				<button
					type="button"
					onClick={() => {
						if (!isBlankPage) onOpenBrowserUrl?.(state.currentUrl);
					}}
					disabled={isBlankPage}
					aria-label="Open as full tab"
					className={cn(
						"flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-accent/60 hover:text-foreground",
						isBlankPage && "opacity-40",
					)}
				>
					<ExternalLink className="size-3.5" />
				</button>
			</div>

			<div className="relative min-h-0 flex-1 bg-white">
				<div ref={placeholderRef} className="h-full w-full" />
				{isBlankPage && !state.isLoading && (
					<div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background">
						<Globe className="size-10 text-muted-foreground/30" />
						<p className="text-xs text-muted-foreground/50">
							Enter a URL above to start browsing
						</p>
					</div>
				)}
			</div>
		</div>
	);
}
