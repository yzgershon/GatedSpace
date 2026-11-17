import type { RendererContext, Tab } from "@superset/panes";
import { toast } from "@superset/ui/sonner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@superset/ui/tooltip";
import { Chrome, GlobeIcon, Loader2 } from "lucide-react";
import { useCallback, useState, useSyncExternalStore } from "react";
import { electronTrpcClient } from "renderer/lib/trpc-client";
import type { BrowserPaneData, PaneViewerData } from "../../../../types";
import { BrowserTabIcon } from "./BrowserTabIcon";
import { browserRuntimeRegistry } from "./browserRuntimeRegistry";
import { BrowserErrorOverlay } from "./components/BrowserErrorOverlay";
import { BrowserPreviewControls } from "./components/BrowserPreviewControls/BrowserPreviewControls";
import { BrowserToolbar } from "./components/BrowserToolbar";
import "./browser-preview.css";
import { usePersistentWebview } from "./hooks/usePersistentWebview";

function getSingleBrowserPane(
	tab: Tab<PaneViewerData>,
): { id: string; data: BrowserPaneData } | null {
	const paneIds = Object.keys(tab.panes);
	if (paneIds.length !== 1) return null;
	const pane = tab.panes[paneIds[0]];
	if (pane.kind !== "browser") return null;
	return { id: pane.id, data: pane.data as BrowserPaneData };
}

export function renderBrowserTabIcon(tab: Tab<PaneViewerData>) {
	const browser = getSingleBrowserPane(tab);
	return browser ? <BrowserTabIcon data={browser.data} /> : null;
}

interface BrowserPaneProps {
	ctx: RendererContext<PaneViewerData>;
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

export function BrowserPane({ ctx }: BrowserPaneProps) {
	const paneId = ctx.pane.id;
	const state = useBrowserState(paneId);
	const { placeholderRef, reload } = usePersistentWebview({ paneId, ctx });
	const data = ctx.pane.data as BrowserPaneData;
	const mode = data.previewMode ?? "responsive";

	const isBlankPage = !state.currentUrl || state.currentUrl === "about:blank";

	return (
		<div className="relative flex flex-1 h-full min-h-0 min-w-0 flex-col">
			<div
				className="gs-browser-stage"
				data-device={mode !== "responsive"}
				data-browser-clip
			>
				<div ref={placeholderRef} data-browser-placeholder />
				{state.error && !state.isLoading && (
					<BrowserErrorOverlay error={state.error} onRetry={reload} />
				)}
				{isBlankPage && !state.isLoading && !state.error && (
					<div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background pointer-events-none">
						<GlobeIcon className="size-10 text-muted-foreground/30" />
						<div className="text-center">
							<p className="text-sm font-medium text-muted-foreground/50">
								Browser
							</p>
							<p className="mt-1 text-xs text-muted-foreground/30">
								Enter a URL above, or instruct an agent to navigate
								<br />
								and use the browser
							</p>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}

interface BrowserPaneToolbarProps {
	ctx: RendererContext<PaneViewerData>;
}

export function BrowserPaneToolbar({ ctx }: BrowserPaneToolbarProps) {
	const data = ctx.pane.data as BrowserPaneData;
	const mode = data.previewMode ?? "responsive";
	const orientation = data.previewOrientation ?? "portrait";
	const paneId = ctx.pane.id;
	const state = useBrowserState(paneId);

	const [openingChrome, setOpeningChrome] = useState(false);
	const openChrome = async () => {
		if (openingChrome) return;
		setOpeningChrome(true);
		try {
			await electronTrpcClient.browser.openInChrome.mutate({
				url: state.currentUrl,
			});
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Could not open Chrome",
			);
		} finally {
			setOpeningChrome(false);
		}
	};

	const handleGoBack = useCallback(() => {
		browserRuntimeRegistry.goBack(paneId);
	}, [paneId]);

	const handleGoForward = useCallback(() => {
		browserRuntimeRegistry.goForward(paneId);
	}, [paneId]);

	const handleReload = useCallback(() => {
		browserRuntimeRegistry.reload(paneId);
	}, [paneId]);

	const handleNavigate = useCallback(
		(url: string) => {
			browserRuntimeRegistry.navigate(paneId, url);
		},
		[paneId],
	);

	const isBlankPage = !state.currentUrl || state.currentUrl === "about:blank";

	return (
		<div className="flex h-full w-full min-w-0 items-center justify-between">
			<BrowserToolbar
				currentUrl={state.currentUrl}
				faviconUrl={state.faviconUrl}
				pageTitle={state.pageTitle}
				isLoading={state.isLoading}
				canGoBack={state.canGoBack}
				canGoForward={state.canGoForward}
				onGoBack={handleGoBack}
				onGoForward={handleGoForward}
				onReload={handleReload}
				onNavigate={handleNavigate}
			/>
			<div className="flex shrink-0 items-center gap-0.5 pr-1">
				<Tooltip>
					<TooltipTrigger asChild>
						<button
							type="button"
							aria-label="Open in Chrome"
							disabled={isBlankPage || openingChrome}
							onClick={() => void openChrome()}
							className="gs-browser-nav-button"
						>
							{openingChrome ? (
								<Loader2 className="size-4 animate-spin" />
							) : (
								<Chrome className="size-4" />
							)}
						</button>
					</TooltipTrigger>
					<TooltipContent side="bottom" showArrow={false}>
						Open in Chrome
					</TooltipContent>
				</Tooltip>

				<BrowserPreviewControls
					mode={mode}
					orientation={orientation}
					scale={state.previewScale}
					onChange={(previewMode, previewOrientation) =>
						ctx.actions.updateData({ ...data, previewMode, previewOrientation })
					}
				/>
			</div>
		</div>
	);
}
