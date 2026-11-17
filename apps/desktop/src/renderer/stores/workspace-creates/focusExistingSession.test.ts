import { expect, test } from "bun:test";
import { createWorkspaceStore, type WorkspaceState } from "@superset/panes";
import type { PaneViewerData } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/types";
import type { AppCollections } from "renderer/routes/_authenticated/providers/CollectionsProvider/collections";
import { findSessionPane, focusExistingSession } from "./focusExistingSession";

test("matches the exact provider and conversation, excluding a pending fork", () => {
	const store = createWorkspaceStore<PaneViewerData>();
	store.getState().addTab({
		panes: [
			{ id: "claude", kind: "session", data: { resumeSessionId: "same" } },
			{
				id: "fork",
				kind: "session",
				data: { provider: "codex", resumeSessionId: "same", forkSession: true },
			},
			{
				id: "codex",
				kind: "session",
				data: { provider: "codex", resumeSessionId: "same" },
			},
		],
	});
	expect(
		findSessionPane(store.getState(), { provider: "codex", sessionId: "same" })
			?.paneId,
	).toBe("codex");
	expect(
		findSessionPane(store.getState(), { provider: "claude", sessionId: "same" })
			?.paneId,
	).toBe("claude");
	expect(
		findSessionPane(store.getState(), {
			provider: "codex",
			sessionId: "unknown",
		}),
	).toBeNull();
	expect(store.getState().tabs).toHaveLength(1);
});
test("finds an existing terminal by its authenticated agent binding", () => {
	const store = createWorkspaceStore<PaneViewerData>();
	store.getState().addTab({
		panes: [
			{ id: "terminal", kind: "terminal", data: { terminalId: "pty-1" } },
		],
	});
	expect(
		findSessionPane(store.getState(), {
			provider: "codex",
			sessionId: "thread",
			terminalId: "pty-1",
		})?.paneId,
	).toBe("terminal");
});

test("focuses a conversation across workspaces and reveals it without adding a pane", () => {
	const current = createWorkspaceStore<PaneViewerData>();
	current.getState().addTab({
		panes: [
			{
				id: "other",
				kind: "session",
				data: { provider: "codex", resumeSessionId: "other" },
			},
		],
	});
	const target = createWorkspaceStore<PaneViewerData>();
	target.getState().addTab({
		panes: [
			{
				id: "hidden",
				kind: "session",
				data: { provider: "codex", resumeSessionId: "wanted" },
			},
			{
				id: "visible",
				kind: "session",
				data: { provider: "claude", resumeSessionId: "second" },
			},
		],
	});
	const targetLayout = {
		...target.getState(),
		tabs: target.getState().tabs.map((tab) => ({
			...tab,
			activePaneId: "visible",
			maximizedPaneId: "visible",
		})),
	};
	type Row = {
		workspaceId: string;
		paneLayout: WorkspaceState<PaneViewerData>;
	};
	const currentRow: Row = {
		workspaceId: "current",
		paneLayout: current.getState(),
	};
	const targetRow: Row = { workspaceId: "target", paneLayout: targetLayout };
	const rows = new Map([
		["current", currentRow],
		["target", targetRow],
	]);
	const before = targetRow.paneLayout;
	const collections = {
		v2WorkspaceLocalState: {
			state: rows,
			update: (id: string, update: (row: Row) => void) => {
				const row = rows.get(id);
				if (!row) throw new Error(`Unexpected workspace ${id}`);
				update(row);
			},
		},
	} as unknown as AppCollections;
	expect(
		focusExistingSession(
			collections,
			{ provider: "codex", sessionId: "wanted" },
			"current",
		),
	).toBe("target");
	const after = targetRow.paneLayout;
	expect(after.tabs).toHaveLength(before.tabs.length);
	expect(after.tabs[0].panes).toBe(before.tabs[0].panes);
	expect(after.tabs[0].activePaneId).toBe("hidden");
	expect(after.tabs[0].maximizedPaneId).toBe("hidden");
	expect(currentRow.paneLayout).toBe(current.getState());
});
