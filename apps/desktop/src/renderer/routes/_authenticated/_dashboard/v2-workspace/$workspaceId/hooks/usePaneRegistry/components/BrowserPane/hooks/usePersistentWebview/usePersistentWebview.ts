import type { RendererContext } from "@superset/panes";
import { useCallback, useEffect, useRef } from "react";
import { electronTrpcClient } from "renderer/lib/trpc-client";
import type {
	BrowserPaneData,
	PaneViewerData,
} from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/types";
import type { PersistableBrowserState } from "../../browserRuntimeRegistry";
import { browserRuntimeRegistry } from "../../browserRuntimeRegistry";
import { DEFAULT_BROWSER_URL } from "../../constants";

/**
 * Full pane-hosted browser: reads/writes its state through the pane runtime
 * context (`ctx.pane.data`, `ctx.actions.*`). This is how every browser *pane*
 * mounts the shared webview runtime.
 */
interface PaneCtxOptions {
	paneId: string;
	ctx: RendererContext<PaneViewerData>;
}

/**
 * Detached host (e.g. the right-sidebar Browser tab) that has no pane ctx. It
 * supplies just the handful of behaviours the runtime needs, so the same
 * webview-parking logic drives both surfaces without a second copy of the hook.
 */
interface DetachedOptions {
	paneId: string;
	/** Starting URL used only when the runtime entry is first created. */
	initialUrl?: string;
	/** Persist URL/title/favicon changes (host decides where they're stored). */
	onPersist?: (state: PersistableBrowserState) => void;
	/** Runtime asked to close (Cmd+W inside the guest). */
	onRequestClose?: () => void;
	/** A popup or "open link as new split" wants `url` opened elsewhere. */
	onOpenUrl?: (url: string) => void;
}

type UsePersistentWebviewOptions = PaneCtxOptions | DetachedOptions;

function isPaneCtxOptions(
	options: UsePersistentWebviewOptions,
): options is PaneCtxOptions {
	return "ctx" in options && options.ctx != null;
}

export function usePersistentWebview(options: UsePersistentWebviewOptions) {
	const { paneId } = options;
	const placeholderRef = useRef<HTMLDivElement | null>(null);

	// Recompute against the latest options every render so callbacks never
	// close over a stale ctx (mirrors the previous ctxRef pattern).
	const optionsRef = useRef(options);
	optionsRef.current = options;

	const initialUrlRef = useRef(
		isPaneCtxOptions(options)
			? (options.ctx.pane.data as BrowserPaneData).url || DEFAULT_BROWSER_URL
			: options.initialUrl || DEFAULT_BROWSER_URL,
	);

	const persist = useCallback((state: PersistableBrowserState) => {
		const current = optionsRef.current;
		if (isPaneCtxOptions(current)) {
			const data = current.ctx.pane.data as BrowserPaneData;
			if (
				data.url === state.url &&
				data.pageTitle === state.pageTitle &&
				data.faviconUrl === state.faviconUrl
			)
				return;
			current.ctx.actions.updateData({
				...data,
				url: state.url,
				pageTitle: state.pageTitle,
				faviconUrl: state.faviconUrl,
			});
			return;
		}
		current.onPersist?.(state);
	}, []);

	const openUrl = useCallback((url: string) => {
		const current = optionsRef.current;
		if (isPaneCtxOptions(current)) {
			current.ctx.actions.split("right", {
				kind: "browser",
				data: { url } as BrowserPaneData,
			});
			return;
		}
		current.onOpenUrl?.(url);
	}, []);

	const requestClose = useCallback(() => {
		const current = optionsRef.current;
		if (isPaneCtxOptions(current)) {
			// `ctx.actions.close()` runs the standard onBeforeClose hook chain,
			// matching the renderer CLOSE_PANE hotkey path.
			void current.ctx.actions.close();
			return;
		}
		current.onRequestClose?.();
	}, []);

	useEffect(() => {
		const placeholder = placeholderRef.current;
		if (!placeholder) return;

		browserRuntimeRegistry.attach(
			paneId,
			placeholder,
			initialUrlRef.current,
			persist,
		);

		return () => {
			browserRuntimeRegistry.detach(paneId);
		};
	}, [paneId, persist]);

	useEffect(() => {
		const newWindowSub = electronTrpcClient.browser.onNewWindow.subscribe(
			{ paneId },
			{
				onData: ({ url }: { url: string }) => {
					openUrl(url);
				},
			},
		);
		const contextMenuSub =
			electronTrpcClient.browser.onContextMenuAction.subscribe(
				{ paneId },
				{
					onData: ({ action, url }: { action: string; url: string }) => {
						if (action === "open-in-split") {
							openUrl(url);
						}
					},
				},
			);
		const closePaneSub = electronTrpcClient.browser.onClosePane.subscribe(
			{ paneId },
			{
				onData: () => {
					requestClose();
				},
			},
		);
		const reloadPaneSub = electronTrpcClient.browser.onReloadPane.subscribe(
			{ paneId },
			{
				onData: () => {
					browserRuntimeRegistry.reload(paneId);
				},
			},
		);
		return () => {
			newWindowSub.unsubscribe();
			contextMenuSub.unsubscribe();
			closePaneSub.unsubscribe();
			reloadPaneSub.unsubscribe();
		};
	}, [paneId, openUrl, requestClose]);

	const goBack = useCallback(() => {
		browserRuntimeRegistry.goBack(paneId);
	}, [paneId]);

	const goForward = useCallback(() => {
		browserRuntimeRegistry.goForward(paneId);
	}, [paneId]);

	const reload = useCallback(() => {
		browserRuntimeRegistry.reload(paneId);
	}, [paneId]);

	const navigateTo = useCallback(
		(url: string) => {
			browserRuntimeRegistry.navigate(paneId, url);
		},
		[paneId],
	);

	return {
		placeholderRef,
		goBack,
		goForward,
		reload,
		navigateTo,
	};
}
