import { expect, test } from "bun:test";
import { createWorkspaceStore } from "@superset/panes";
import type { PaneViewerData } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/types";
import type { SessionNamesSnapshot } from "shared/session-names";
import { applySessionNames } from "./session-name-layout";

test("a stable ID rename updates every matching pane and removes stale single-tab titles", () => {
	const store = createWorkspaceStore<PaneViewerData>();
	for (const id of ["a", "b"]) {
		store.getState().addTab({
			id,
			titleOverride: "Old tab",
			panes: [
				{
					id: `p-${id}`,
					kind: "session",
					titleOverride: "Old pane",
					data: { provider: "codex", resumeSessionId: "thread" },
				},
			],
		});
	}
	const snapshot: SessionNamesSnapshot = {
		names: {
			"codex:thread": { title: "Authentication fixes", source: "manual" },
		},
		aliases: {},
	};
	applySessionNames(store, snapshot);
	for (const tab of store.getState().tabs) {
		expect(tab.titleOverride).toBeUndefined();
		expect(Object.values(tab.panes)[0].titleOverride).toBe(
			"Authentication fixes",
		);
	}
	applySessionNames(store, { names: {}, aliases: {} }, snapshot);
	expect(
		Object.values(store.getState().tabs[0].panes)[0].titleOverride,
	).toBeUndefined();
});
test("existing user pane and group names are preserved during automatic naming", () => {
	const store = createWorkspaceStore<PaneViewerData>();
	store.getState().addTab({
		id: "group",
		titleOverride: "My group",
		panes: [
			{
				id: "old",
				kind: "session",
				titleOverride: "My existing session",
				data: { provider: "claude", resumeSessionId: "old" },
			},
			{
				id: "new",
				kind: "terminal",
				data: { terminalId: "terminal", initialTitle: "Claude" },
			},
		],
	});
	applySessionNames(store, {
		names: {
			"claude:old": { title: "Generated", source: "generated" },
			"terminal:terminal": { title: "Run tests", source: "generated" },
		},
		aliases: {},
	});
	const tab = store.getState().tabs[0];
	expect(tab.titleOverride).toBe("My group");
	expect(tab.panes.old.titleOverride).toBe("My existing session");
	expect(tab.panes.new.titleOverride).toBe("Run tests");
});
test("native pending pane and linked terminal resolve the same canonical title", () => {
	const store = createWorkspaceStore<PaneViewerData>();
	store.getState().addTab({
		id: "t",
		panes: [
			{ id: "pending", kind: "session", data: { provider: "claude" } },
			{ id: "terminal", kind: "terminal", data: { terminalId: "shell" } },
		],
	});
	applySessionNames(store, {
		names: { "claude:session": { title: "Iceland trip", source: "manual" } },
		aliases: {
			"claude:pending:pending": "claude:session",
			"terminal:shell": "claude:session",
		},
	});
	for (const pane of Object.values(store.getState().tabs[0].panes))
		expect(pane.titleOverride).toBe("Iceland trip");
});
