import { electronTrpcClient } from "renderer/lib/trpc-client";
import type {
	BrowserPreviewConfig,
	BrowserPreviewMode,
	BrowserPreviewOrientation,
} from "shared/browser-preview";
import type { BrowserLoadError } from "shared/tabs-types";
import { previewLayout } from "./preview-layout";
import { sanitizeUrl } from "./sanitizeUrl";

export interface BrowserRuntimeState {
	currentUrl: string;
	pageTitle: string;
	faviconUrl: string | null;
	isLoading: boolean;
	error: BrowserLoadError | null;
	canGoBack: boolean;
	canGoForward: boolean;
	previewScale: number;
}

export interface PersistableBrowserState {
	url: string;
	pageTitle: string;
	faviconUrl: string | null;
}

interface RegistryEntry {
	paneId: string;
	webview: Electron.WebviewTag;
	state: BrowserRuntimeState;
	onPersist: ((state: PersistableBrowserState) => void) | null;
	webContentsId: number | null;
	detachHandlers: () => void;
	placeholder: HTMLElement | null;
	resizeObserver: ResizeObserver | null;
	preview: BrowserPreviewConfig;
	previewApplied: string | null;
	previewPending: boolean;
	registered: boolean;
	visibilityObserver: MutationObserver | null;
	visible: boolean;
	/** True while the page has been discarded (navigated to about:blank). */
	suspended: boolean;
	/** URL to reload from when the pane is shown again after being discarded. */
	suspendedUrl: string | null;
	/** Pending grace-period timer that discards this pane once idle. */
	suspendTimer: ReturnType<typeof setTimeout> | null;
}

const EMPTY_STATE: BrowserRuntimeState = Object.freeze({
	currentUrl: "about:blank",
	pageTitle: "",
	faviconUrl: null,
	isLoading: false,
	error: null,
	canGoBack: false,
	canGoForward: false,
	previewScale: 1,
});

const ROOT_CONTAINER_ID = "browser-runtime-root";

/**
 * How long a browser pane may sit hidden before we discard its page to free
 * memory and stop background CPU/GPU work (timers, requestAnimationFrame,
 * video). The <webview> element and its saved URL are kept; the page reloads
 * from that URL the next time the pane is shown. Mirrors Chrome/Edge
 * "sleeping tabs". Panes that are actively playing audio are never discarded,
 * so background music keeps playing.
 */
const SUSPEND_HIDDEN_AFTER_MS = 60_000;

class BrowserRuntimeRegistryImpl {
	private entries = new Map<string, RegistryEntry>();
	private listenersByPaneId = new Map<string, Set<() => void>>();
	private rootContainer: HTMLDivElement | null = null;
	private globalListenersInstalled = false;
	private windowDragPassthrough = false;
	private shellInteractionPassthrough = false;

	private getListeners(paneId: string): Set<() => void> {
		let set = this.listenersByPaneId.get(paneId);
		if (!set) {
			set = new Set();
			this.listenersByPaneId.set(paneId, set);
		}
		return set;
	}

	private ensureRootContainer(): HTMLDivElement {
		if (this.rootContainer?.isConnected) {
			this.installGlobalListeners();
			return this.rootContainer;
		}
		const existing = document.getElementById(
			ROOT_CONTAINER_ID,
		) as HTMLDivElement | null;
		if (existing) {
			this.rootContainer = existing;
			this.installGlobalListeners();
			return existing;
		}
		const root = document.createElement("div");
		root.id = ROOT_CONTAINER_ID;
		root.style.position = "fixed";
		root.style.top = "0";
		root.style.left = "0";
		root.style.width = "0";
		root.style.height = "0";
		root.style.pointerEvents = "none";
		root.style.zIndex = "0";
		document.body.appendChild(root);
		this.rootContainer = root;
		this.installGlobalListeners();
		return root;
	}

	private installGlobalListeners() {
		if (this.globalListenersInstalled) return;
		this.globalListenersInstalled = true;

		window.addEventListener(
			"dragstart",
			() => this.setWindowDragPassthrough(true),
			true,
		);
		window.addEventListener(
			"dragend",
			() => this.setWindowDragPassthrough(false),
			true,
		);
		window.addEventListener(
			"drop",
			() => this.setWindowDragPassthrough(false),
			true,
		);
		window.addEventListener("blur", () => this.setWindowDragPassthrough(false));

		window.addEventListener("resize", () => {
			for (const entry of this.entries.values()) {
				if (entry.placeholder) this.updateLayout(entry);
			}
		});
	}

	private setWindowDragPassthrough(passthrough: boolean) {
		const wasActive = this.isPointerPassthroughActive();
		this.windowDragPassthrough = passthrough;
		this.applyPointerPassthroughIfChanged(wasActive);
	}

	setShellInteractionPassthrough(passthrough: boolean): void {
		const wasActive = this.isPointerPassthroughActive();
		this.shellInteractionPassthrough = passthrough;
		this.applyPointerPassthroughIfChanged(wasActive);
	}

	private isPointerPassthroughActive() {
		return this.windowDragPassthrough || this.shellInteractionPassthrough;
	}

	private applyPointerPassthroughIfChanged(wasActive: boolean) {
		const isActive = this.isPointerPassthroughActive();
		if (wasActive !== isActive) this.applyPointerPassthrough();
	}

	private applyPointerPassthrough() {
		const passthrough = this.isPointerPassthroughActive();
		for (const entry of this.entries.values()) {
			if (!entry.visible) continue;
			entry.webview.style.pointerEvents = passthrough ? "none" : "auto";
		}
	}

	private updateLayout(entry: RegistryEntry) {
		if (!entry.placeholder) return;
		const placeholder = entry.placeholder;
		const clips = [{ left: 0, top: 0, width: innerWidth, height: innerHeight }];
		for (
			let parent = placeholder.parentElement;
			parent;
			parent = parent.parentElement
		) {
			if (parent.hasAttribute("data-browser-clip"))
				clips.push(parent.getBoundingClientRect());
		}
		const layout = previewLayout(
			placeholder.getBoundingClientRect(),
			clips,
			entry.preview.mode,
			entry.preview.orientation,
		);
		const visible =
			layout.visible &&
			!placeholder.closest('[inert], [hidden], [aria-hidden="true"]') &&
			getComputedStyle(placeholder).visibility !== "hidden";
		entry.webview.style.visibility = visible ? "visible" : "hidden";
		entry.webview.style.pointerEvents =
			visible && !this.isPointerPassthroughActive() ? "auto" : "none";
		Object.assign(entry.webview.style, {
			transform: "",
			top: `${layout.top}px`,
			left: `${layout.left}px`,
			width: `${Math.max(0, layout.width)}px`,
			height: `${Math.max(0, layout.height)}px`,
			clipPath: layout.clipPath,
		});
		entry.preview.scale = Math.max(0.01, layout.scale);
		this.setState(entry.paneId, { previewScale: layout.scale });
		if (visible) this.syncPreview(entry);
	}

	private async syncPreview(entry: RegistryEntry) {
		if (!entry.registered || entry.previewPending) return;
		const config = { ...entry.preview };
		const key = JSON.stringify(config);
		if (entry.previewApplied === key) return;
		entry.previewPending = true;
		try {
			const applied = await electronTrpcClient.browser.setPreview.mutate({
				paneId: entry.paneId,
				...config,
			});
			if (applied.success) entry.previewApplied = key;
		} catch (error) {
			console.error("[browserRuntimeRegistry] preview failed:", error);
		} finally {
			entry.previewPending = false;
			if (entry.placeholder && key !== JSON.stringify(entry.preview))
				void this.syncPreview(entry);
		}
	}

	private notify(paneId: string) {
		const listeners = this.listenersByPaneId.get(paneId);
		if (!listeners) return;
		for (const listener of listeners) listener();
	}

	private setState(paneId: string, patch: Partial<BrowserRuntimeState>) {
		const entry = this.entries.get(paneId);
		if (!entry) return;
		let changed = false;
		for (const key in patch) {
			const k = key as keyof BrowserRuntimeState;
			if (entry.state[k] !== patch[k]) {
				changed = true;
				break;
			}
		}
		if (!changed) return;
		entry.state = { ...entry.state, ...patch };
		this.notify(paneId);
	}

	private refreshNavState(paneId: string) {
		const entry = this.entries.get(paneId);
		if (!entry) return;
		let canGoBack = false;
		let canGoForward = false;
		try {
			canGoBack = entry.webview.canGoBack();
			canGoForward = entry.webview.canGoForward();
		} catch {}
		this.setState(paneId, { canGoBack, canGoForward });
	}

	private clearSuspendTimer(entry: RegistryEntry) {
		if (entry.suspendTimer) {
			clearTimeout(entry.suspendTimer);
			entry.suspendTimer = null;
		}
	}

	/**
	 * Arm the grace-period timer that discards this pane once it has been
	 * hidden long enough. No-op for blank panes (nothing to free) or panes
	 * already discarded.
	 */
	private scheduleSuspend(entry: RegistryEntry) {
		this.clearSuspendTimer(entry);
		if (entry.suspended) return;
		const url = entry.state.currentUrl;
		if (!url || url === "about:blank") return;
		entry.suspendTimer = setTimeout(() => {
			entry.suspendTimer = null;
			this.suspendNow(entry);
		}, SUSPEND_HIDDEN_AFTER_MS);
	}

	/**
	 * Discard the pane's page: remember its URL and navigate the guest to
	 * about:blank so Chromium unloads the document and stops all of its
	 * background work. Skipped while the pane is visible or currently audible;
	 * an audible pane is re-checked after another grace period.
	 */
	private suspendNow(entry: RegistryEntry) {
		if (entry.suspended || entry.visible) return;
		const url = entry.state.currentUrl;
		if (!url || url === "about:blank") return;

		let audible = false;
		try {
			audible = entry.webview.isCurrentlyAudible();
		} catch {}
		if (audible) {
			entry.suspendTimer = setTimeout(() => {
				entry.suspendTimer = null;
				this.suspendNow(entry);
			}, SUSPEND_HIDDEN_AFTER_MS);
			return;
		}

		entry.suspendedUrl = url;
		entry.suspended = true;
		entry.webview.loadURL("about:blank").catch(() => {});
	}

	/** Reload the saved URL when a discarded pane is shown again. */
	private resumeIfSuspended(entry: RegistryEntry) {
		if (!entry.suspended) return;
		const url = entry.suspendedUrl;
		entry.suspended = false;
		entry.suspendedUrl = null;
		if (url && url !== "about:blank") {
			entry.webview.loadURL(sanitizeUrl(url)).catch(() => {});
		}
	}

	private createEntry(paneId: string, initialUrl: string): RegistryEntry {
		const webview = document.createElement("webview") as Electron.WebviewTag;
		webview.setAttribute("partition", "persist:superset");
		webview.setAttribute("allowpopups", "");
		webview.style.position = "fixed";
		webview.style.top = "0";
		webview.style.left = "0";
		webview.style.width = "0";
		webview.style.height = "0";
		webview.style.margin = "0";
		webview.style.padding = "0";
		webview.style.border = "none";
		webview.style.visibility = "hidden";
		webview.style.pointerEvents = "auto";
		webview.src = sanitizeUrl(initialUrl);

		const entry: RegistryEntry = {
			paneId,
			webview,
			state: { ...EMPTY_STATE, currentUrl: initialUrl },
			onPersist: null,
			webContentsId: null,
			detachHandlers: () => {},
			placeholder: null,
			resizeObserver: null,
			preview: { mode: "responsive", orientation: "portrait", scale: 1 },
			previewApplied: null,
			previewPending: false,
			registered: false,
			visibilityObserver: null,
			visible: false,
			suspended: false,
			suspendedUrl: null,
			suspendTimer: null,
		};

		const firePersist = () => {
			entry.onPersist?.({
				url: entry.state.currentUrl,
				pageTitle: entry.state.pageTitle,
				faviconUrl: entry.state.faviconUrl,
			});
		};
		const handleFocus = () => {
			// The native guest is outside the pane DOM; forward its focus to the
			// placeholder so the owning workspace/tool group gets keyboard state.
			entry.placeholder?.dispatchEvent(
				new FocusEvent("focusin", { bubbles: true }),
			);
		};
		webview.addEventListener("focus", handleFocus);

		const handleDomReady = async () => {
			const webContentsId = webview.getWebContentsId();
			try {
				if (entry.webContentsId !== webContentsId || !entry.registered) {
					entry.registered = false;
					await electronTrpcClient.browser.register.mutate({
						paneId,
						webContentsId,
					});
					entry.webContentsId = webContentsId;
					entry.registered = true;
				}
				entry.previewApplied = null;
				this.updateLayout(entry);
			} catch (error) {
				console.error("[browserRuntimeRegistry] register failed:", error);
			}
		};

		const handleDidStartLoading = () => {
			// Ignore the discard navigation to about:blank; the pane keeps
			// displaying its real (suspended) URL until it's resumed.
			if (entry.suspended) return;
			this.setState(paneId, {
				isLoading: true,
				error: null,
				faviconUrl: null,
			});
		};

		const handleDidStopLoading = () => {
			if (entry.suspended) return;
			const url = webview.getURL() ?? "";
			const title = webview.getTitle() ?? "";
			this.setState(paneId, {
				isLoading: false,
				currentUrl: url,
				pageTitle: title,
			});
			this.refreshNavState(paneId);
			if (url && url !== "about:blank") {
				electronTrpcClient.browserHistory.upsert
					.mutate({ url, title, faviconUrl: entry.state.faviconUrl })
					.catch((err) => {
						console.error("[browserRuntimeRegistry] upsert history:", err);
					});
			}
			firePersist();
		};

		const handleDidNavigate = (e: Electron.DidNavigateEvent) => {
			if (entry.suspended) return;
			const url = e.url ?? "";
			const title = webview.getTitle() ?? "";
			this.setState(paneId, {
				currentUrl: url,
				pageTitle: title,
				isLoading: false,
			});
			this.refreshNavState(paneId);
		};

		const handleDidNavigateInPage = (e: Electron.DidNavigateInPageEvent) => {
			if (entry.suspended) return;
			const url = e.url ?? "";
			const title = webview.getTitle() ?? "";
			this.setState(paneId, { currentUrl: url, pageTitle: title });
			this.refreshNavState(paneId);
		};

		const handlePageTitleUpdated = (e: Electron.PageTitleUpdatedEvent) => {
			if (entry.suspended) return;
			this.setState(paneId, { pageTitle: e.title ?? "" });
		};

		const handlePageFaviconUpdated = (e: Electron.PageFaviconUpdatedEvent) => {
			if (entry.suspended) return;
			const favicon = e.favicons?.[0];
			if (!favicon || favicon === entry.state.faviconUrl) return;
			this.setState(paneId, { faviconUrl: favicon });
			const { currentUrl, pageTitle } = entry.state;
			if (currentUrl && currentUrl !== "about:blank") {
				electronTrpcClient.browserHistory.upsert
					.mutate({ url: currentUrl, title: pageTitle, faviconUrl: favicon })
					.catch((err) => {
						console.error("[browserRuntimeRegistry] upsert favicon:", err);
					});
			}
			firePersist();
		};

		const handleDidFailLoad = (e: Electron.DidFailLoadEvent) => {
			if (entry.suspended) return;
			if (e.errorCode === -3) return; // ERR_ABORTED
			this.setState(paneId, {
				isLoading: false,
				error: {
					code: e.errorCode ?? 0,
					description: e.errorDescription ?? "",
					url: e.validatedURL ?? "",
				},
			});
		};

		webview.addEventListener("dom-ready", handleDomReady);
		webview.addEventListener("did-start-loading", handleDidStartLoading);
		webview.addEventListener("did-stop-loading", handleDidStopLoading);
		webview.addEventListener(
			"did-navigate",
			handleDidNavigate as EventListener,
		);
		webview.addEventListener(
			"did-navigate-in-page",
			handleDidNavigateInPage as EventListener,
		);
		webview.addEventListener(
			"page-title-updated",
			handlePageTitleUpdated as EventListener,
		);
		webview.addEventListener(
			"page-favicon-updated",
			handlePageFaviconUpdated as EventListener,
		);
		webview.addEventListener(
			"did-fail-load",
			handleDidFailLoad as EventListener,
		);

		entry.detachHandlers = () => {
			webview.removeEventListener("focus", handleFocus);
			webview.removeEventListener("dom-ready", handleDomReady);
			webview.removeEventListener("did-start-loading", handleDidStartLoading);
			webview.removeEventListener("did-stop-loading", handleDidStopLoading);
			webview.removeEventListener(
				"did-navigate",
				handleDidNavigate as EventListener,
			);
			webview.removeEventListener(
				"did-navigate-in-page",
				handleDidNavigateInPage as EventListener,
			);
			webview.removeEventListener(
				"page-title-updated",
				handlePageTitleUpdated as EventListener,
			);
			webview.removeEventListener(
				"page-favicon-updated",
				handlePageFaviconUpdated as EventListener,
			);
			webview.removeEventListener(
				"did-fail-load",
				handleDidFailLoad as EventListener,
			);
		};

		return entry;
	}

	attach(
		paneId: string,
		placeholder: HTMLElement,
		initialUrl: string,
		onPersist: (state: PersistableBrowserState) => void,
	): void {
		const root = this.ensureRootContainer();
		let entry = this.entries.get(paneId);
		if (!entry) {
			entry = this.createEntry(paneId, initialUrl);
			this.entries.set(paneId, entry);
			root.appendChild(entry.webview);
		} else {
			// Showing again: cancel any pending discard and reload the page if
			// it was already put to sleep while hidden.
			this.clearSuspendTimer(entry);
			this.resumeIfSuspended(entry);
			this.refreshNavState(paneId);
		}
		entry.onPersist = onPersist;
		entry.placeholder = placeholder;
		entry.visible = true;

		entry.resizeObserver?.disconnect();
		const observer = new ResizeObserver(() => {
			if (entry) this.updateLayout(entry);
		});
		observer.observe(placeholder);
		entry.visibilityObserver?.disconnect();
		const visibilityObserver = new MutationObserver(() => {
			if (entry) this.updateLayout(entry);
		});
		for (
			let parent = placeholder.parentElement;
			parent;
			parent = parent.parentElement
		) {
			if (parent.hasAttribute("data-browser-clip")) observer.observe(parent);
			visibilityObserver.observe(parent, {
				attributes: true,
				attributeFilter: ["inert", "hidden", "aria-hidden", "data-expanded"],
			});
		}
		entry.visibilityObserver = visibilityObserver;
		entry.resizeObserver = observer;

		this.updateLayout(entry);
		this.applyPointerPassthrough();
	}

	detach(paneId: string): void {
		const entry = this.entries.get(paneId);
		if (!entry) return;
		entry.onPersist = null;
		entry.placeholder = null;
		entry.resizeObserver?.disconnect();
		entry.resizeObserver = null;
		entry.visibilityObserver?.disconnect();
		entry.visibilityObserver = null;
		entry.visible = false;
		entry.webview.style.visibility = "hidden";
		// Free the page after a grace period so idle background panes stop
		// draining memory and battery.
		this.scheduleSuspend(entry);
	}

	destroy(paneId: string): void {
		const entry = this.entries.get(paneId);
		if (!entry) return;
		this.clearSuspendTimer(entry);
		entry.resizeObserver?.disconnect();
		entry.visibilityObserver?.disconnect();
		entry.detachHandlers();
		entry.webview.remove();
		this.entries.delete(paneId);
		this.listenersByPaneId.delete(paneId);
		electronTrpcClient.browser.unregister.mutate({ paneId }).catch(() => {});
	}

	navigate(paneId: string, url: string): void {
		const entry = this.entries.get(paneId);
		if (!entry) return;
		entry.webview.loadURL(sanitizeUrl(url)).catch((err) => {
			console.error("[browserRuntimeRegistry] loadURL failed:", err);
		});
	}

	setPreview(
		paneId: string,
		mode: BrowserPreviewMode,
		orientation: BrowserPreviewOrientation,
	): void {
		const entry = this.entries.get(paneId);
		if (!entry) return;
		entry.preview = { mode, orientation, scale: entry.preview.scale };
		this.updateLayout(entry);
	}

	goBack(paneId: string): void {
		const entry = this.entries.get(paneId);
		if (entry?.webview.canGoBack()) entry.webview.goBack();
	}

	goForward(paneId: string): void {
		const entry = this.entries.get(paneId);
		if (entry?.webview.canGoForward()) entry.webview.goForward();
	}

	reload(paneId: string): void {
		const entry = this.entries.get(paneId);
		entry?.webview.reload();
	}

	getState(paneId: string): BrowserRuntimeState {
		return this.entries.get(paneId)?.state ?? EMPTY_STATE;
	}

	onStateChange(paneId: string, listener: () => void): () => void {
		const listeners = this.getListeners(paneId);
		listeners.add(listener);
		return () => {
			listeners.delete(listener);
		};
	}
}

export const browserRuntimeRegistry: BrowserRuntimeRegistryImpl =
	(import.meta.hot?.data?.browserRegistry as
		| BrowserRuntimeRegistryImpl
		| undefined) ?? new BrowserRuntimeRegistryImpl();

if (import.meta.hot) {
	import.meta.hot.data.browserRegistry = browserRuntimeRegistry;
}
