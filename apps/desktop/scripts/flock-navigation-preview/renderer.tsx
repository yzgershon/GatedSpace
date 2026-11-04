import { TooltipProvider } from "@superset/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
} from "@tanstack/react-router";
import { useContext, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { EnsembleWorkspace } from "renderer/components/EnsembleWorkspace/EnsembleWorkspace";
import { validateFlockSearch } from "renderer/components/EnsembleWorkspace/flock-navigation";
import { HotkeyEnabledContext } from "renderer/hotkeys/HotkeyScope";
import { useHotkey } from "renderer/hotkeys/hooks/useHotkey/useHotkey";
import { useHotkeyOverridesStore } from "renderer/hotkeys/stores/hotkeyOverridesStore";
import { DashboardContent } from "renderer/routes/_authenticated/_dashboard/components/DashboardContent/DashboardContent";
import { DashboardSidebarNav } from "renderer/routes/_authenticated/_dashboard/components/DashboardSidebar/components/DashboardSidebarNav/DashboardSidebarNav";
import { draculaTheme } from "shared/themes/built-in/dracula";
import { probe, snapshot } from "./mock";
import "../../src/renderer/globals.css";

for (const [key, value] of Object.entries(draculaTheme.ui)) {
	if (typeof value === "string")
		document.documentElement.style.setProperty(
			`--${key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`,
			value,
		);
}
document.documentElement.classList.add("dark");
const params = new URLSearchParams(location.search);
useHotkeyOverridesStore.getState().setOverride("CLOSE_TAB", "ctrl+shift+k");
probe.mode = (params.get("mode") as typeof probe.mode) || "ready";
const client = new QueryClient({
	defaultOptions: { queries: { retry: false } },
});

function Workspace() {
	const shortcutsEnabled = useContext(HotkeyEnabledContext);
	useHotkey("CLOSE_TAB", () => {
		probe.shortcutInvocations++;
	});
	useEffect(() => {
		probe.workspaceMounts++;
		return () => {
			probe.workspaceUnmounts++;
		};
	}, []);
	return (
		<section
			className="flex flex-1 flex-col gap-4 bg-card p-6"
			aria-label="Existing session"
		>
			<h1>Current conversation</h1>
			<p>Navigation test · simulated session and transport</p>
			<textarea aria-label="Session draft" defaultValue="Keep my draft" />
			<output data-testid="shortcuts">{String(shortcutsEnabled)}</output>
		</section>
	);
}
function Shell() {
	return (
		<div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
			<header className="flex h-12 shrink-0 items-center px-4">
				GatedSpace · Flock navigation test
			</header>
			<div className="flex flex-1 min-h-0 min-w-0 gap-3 p-3">
				<aside className="w-60 shrink-0 rounded-xl bg-card p-3">
					<DashboardSidebarNav workspaceCount={1} />
				</aside>
				<DashboardContent>
					<Outlet />
				</DashboardContent>
			</div>
		</div>
	);
}
const rootRoute = createRootRoute({
	component: Shell,
	validateSearch: validateFlockSearch,
});
const history = createMemoryHistory({
	initialEntries: [
		params.has("legacy") ? "/ensemble" : "/v2-workspace/current",
	],
});
const router = createRouter({
	history,
	routeTree: rootRoute.addChildren([
		createRoute({
			getParentRoute: () => rootRoute,
			path: "/v2-workspace/$workspaceId",
			component: Workspace,
		}),
		createRoute({
			getParentRoute: () => rootRoute,
			path: "/v2-workspace",
			component: Workspace,
		}),
		createRoute({
			getParentRoute: () => rootRoute,
			path: "/ensemble",
			component: () => null,
		}),
	]),
});
Object.assign(window, {
	flockTest: {
		probe,
		history,
		client,
		location: () => router.state.location,
		recover: () => {
			probe.mode = "ready";
			client.setQueryData(["flock-snapshot"], snapshot);
		},
	},
});
const root = document.createElement("div");
document.body.append(root);
createRoot(root).render(
	<QueryClientProvider client={client}>
		<TooltipProvider>
			<RouterProvider router={router} />
		</TooltipProvider>
	</QueryClientProvider>,
);

// Keep a production Flock root directly inside a row flexbox too. The old
// inline-size containment collapsed this exact embedding to zero pixels wide.
if (params.has("direct")) {
	const direct = document.createElement("div");
	direct.id = "direct-embedding";
	direct.style.cssText = "display:flex;width:900px;height:700px";
	document.body.append(direct);
	createRoot(direct).render(
		<EnsembleWorkspace
			snapshot={snapshot}
			workspaces={[]}
			actions={{} as never}
		/>,
	);
}
