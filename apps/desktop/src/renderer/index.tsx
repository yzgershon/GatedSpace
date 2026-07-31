import { initSentry } from "./lib/sentry";

initSentry();

import { createRouter, RouterProvider } from "@tanstack/react-router";
import ReactDom from "react-dom/client";
import { BootErrorBoundary } from "./components/BootErrorBoundary";
import { applyStoredAuthTokenBeforeRender } from "./lib/auth-bootstrap";
import {
	cleanupBootErrorHandling,
	initBootErrorHandling,
	isBootErrorReported,
	markBootMounted,
	reportBootError,
} from "./lib/boot-errors";
import { persistentHistory } from "./lib/persistent-hash-history";
import { posthog } from "./lib/posthog";
import { electronQueryClient } from "./providers/ElectronTRPCProvider";
import { NotFound } from "./routes/not-found";
import { routeTree } from "./routeTree.gen";

import "./globals.css";
import "./styles/bundled-fonts.css";
import { trackFocusSurface } from "renderer/lib/focus-surface";
import { suppressMiddleClickAutoscroll } from "renderer/lib/suppress-middle-click-autoscroll";

const rootElement = document.querySelector("app");
initBootErrorHandling(rootElement);

const router = createRouter({
	routeTree,
	history: persistentHistory,
	defaultPreload: "intent",
	defaultNotFoundComponent: NotFound,
	context: {
		queryClient: electronQueryClient,
	},
});

const unsubscribe = router.subscribe("onResolved", (event) => {
	posthog.capture("$pageview", {
		$current_url: event.toLocation.pathname,
	});
});

const handleDeepLink = (path: string) => {
	console.log("[deep-link] Navigating to:", path);
	router.navigate({ to: path });
};
const ipcRenderer = window.ipcRenderer as typeof window.ipcRenderer | undefined;
if (ipcRenderer) {
	ipcRenderer.on("deep-link-navigate", handleDeepLink);
} else {
	reportBootError(
		"Renderer preload not available (window.ipcRenderer missing)",
	);
}

if (import.meta.hot) {
	import.meta.hot.dispose(() => {
		unsubscribe();
		if (ipcRenderer) {
			ipcRenderer.off("deep-link-navigate", handleDeepLink);
		}
		cleanupBootErrorHandling();
	});
}

declare module "@tanstack/react-router" {
	interface Register {
		router: typeof router;
	}
}

// Before render: middle-click means "close this" here, never "start scrolling".
suppressMiddleClickAutoscroll();
// Tells GatedVoice whether to paste or type; see lib/focus-surface.ts.
trackFocusSurface();

/*
 * The stored auth token is applied BEFORE the first render, not in an effect
 * after it.
 *
 * Better Auth's session store fires its first request the moment something
 * subscribes during render. With the token arriving later, that request went out
 * unauthenticated and the app had to make a second one and WAIT for it — 4.7s of
 * cold launch, measured. Applying it here makes the first request the
 * authenticated one.
 *
 * Wrapped in a function rather than using top-level await, so this does not
 * depend on the renderer bundle's module format. It is bounded by a timeout
 * inside, because nothing may indefinitely prevent the app from painting.
 */
async function bootstrapRenderer(root: Element) {
	await applyStoredAuthTokenBeforeRender();
	if (isBootErrorReported()) return;
	ReactDom.createRoot(root).render(
		<BootErrorBoundary
			onError={(error) => reportBootError("Render failed", error)}
		>
			<RouterProvider router={router} />
		</BootErrorBoundary>,
	);
	markBootMounted();
}

if (!rootElement) {
	reportBootError("Missing <app> root element");
} else if (!isBootErrorReported()) {
	void bootstrapRenderer(rootElement).catch((error: unknown) => {
		reportBootError("Boot failed", error);
	});
}
