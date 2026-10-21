import { beforeEach, expect, mock, test } from "bun:test";
import { type ComponentType, createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

let workspaceId: string | null = null;
let isReady = false;
let workspaces: { id: string; projectId: string }[] = [];

mock.module("@tanstack/react-router", () => ({
	createFileRoute: () => (options: object) => ({ options }),
	useMatchRoute: () => () => (workspaceId ? { workspaceId } : false),
	Outlet: () => createElement("div", null, "workspace index outlet"),
}));
mock.module("@tanstack/react-db", () => ({
	useLiveQuery: () => ({ data: [] }),
}));
mock.module("renderer/hooks/useV2UserPreferences", () => ({
	useV2UserPreferences: () => ({ toggleShowPresetsBar: () => {} }),
}));
mock.module("renderer/lib/electron-trpc", () => ({
	electronTrpc: { menu: { subscribe: { useSubscription: () => {} } } },
}));
mock.module(
	"renderer/routes/_authenticated/hooks/useDashboardSidebarState",
	() => ({
		useDashboardSidebarState: () => ({ ensureWorkspaceInSidebar: () => {} }),
	}),
);
mock.module(
	"renderer/routes/_authenticated/providers/CollectionsProvider",
	() => ({
		useCollections: () => ({}),
	}),
);
mock.module(
	"renderer/routes/_authenticated/providers/HostWorkspacesProvider",
	() => ({
		useHostWorkspaces: () => ({ workspaces, isReady }),
	}),
);
mock.module("renderer/stores/workspace-creates", () => ({
	useWorkspaceTransactionsStore: () => null,
}));
mock.module("./hooks/useRemoteHostStatus", () => ({
	useRemoteHostStatus: () => ({ status: "ready" }),
}));
mock.module("./providers/WorkspaceProvider", () => ({
	WorkspaceProvider: ({ children }: { children: ReactNode }) =>
		createElement("section", { "data-workspace": true }, children),
}));
for (const name of [
	"WorkspaceCreateErrorState",
	"WorkspaceCreatingState",
	"WorkspaceHostIncompatibleState",
	"WorkspaceLoadingState",
	"WorkspaceNotFoundState",
]) {
	mock.module(`./components/${name}`, () => ({
		[name]: () => createElement("div", null, name),
	}));
}

const { Route } = await import("./layout");
const render = () =>
	renderToStaticMarkup(createElement(Route.options.component as ComponentType));

beforeEach(() => {
	workspaceId = null;
	isReady = false;
	workspaces = [];
});

test("fresh launch mounts the index so it can select setup or restore a workspace", () => {
	expect(render()).toContain("workspace index outlet");
	isReady = true;
	expect(render()).toContain("workspace index outlet");
});

test("a specific workspace still waits for host data", () => {
	workspaceId = "saved-workspace";
	expect(render()).toContain("WorkspaceLoadingState");
});

test("a missing workspace is reported only after the host is ready", () => {
	workspaceId = "missing-workspace";
	isReady = true;
	expect(render()).toContain("WorkspaceNotFoundState");
});

test("an existing workspace keeps its provider and nested page", () => {
	workspaceId = "saved-workspace";
	workspaces = [{ id: workspaceId, projectId: "project" }];
	expect(render()).toContain('data-workspace="true"');
	expect(render()).toContain("workspace index outlet");
});
