import { expect, test } from "bun:test";
import type { Tab } from "@superset/panes";
import type { PaneViewerData } from "../../types";
import { workspaceSessions } from "./workspace-sessions";

function mixedTab(): Tab<PaneViewerData> {
	return {
		id: "mixed",
		titleOverride: "Product launch",
		createdAt: 0,
		activePaneId: "codex",
		layout: { type: "pane", paneId: "codex" },
		panes: {
			codex: { id: "codex", kind: "session", data: { provider: "codex" } },
			claude: { id: "claude", kind: "session", data: { provider: "claude" } },
			legacy: { id: "legacy", kind: "session", data: {} },
			browser: { id: "browser", kind: "browser", data: { url: "about:blank" } },
			terminal: {
				id: "terminal",
				kind: "terminal",
				data: { terminalId: "shell", agentId: "codex" },
			},
		},
	};
}

test("mixed sessions use their saved provider before either transport connects", () => {
	expect(workspaceSessions(mixedTab(), ["claude", "codex", "legacy"])).toEqual([
		{ paneId: "claude", provider: "claude", title: undefined },
		{ paneId: "codex", provider: "codex", title: undefined },
		{ paneId: "legacy", provider: "claude", title: undefined },
	]);
});

test("provider identity does not depend on the title, and explicit names survive", () => {
	const tab = mixedTab();
	tab.panes.codex.titleOverride = "Review Claude integration";
	tab.panes.claude.titleOverride = "Improve Codex composer";
	expect(workspaceSessions(tab, ["codex", "claude"])).toEqual([
		{ paneId: "codex", provider: "codex", title: "Review Claude integration" },
		{ paneId: "claude", provider: "claude", title: "Improve Codex composer" },
	]);
});

test("only native session panes in the current layout become session buttons", () => {
	const tab = mixedTab();
	expect(
		workspaceSessions(tab, ["browser", "terminal", "missing", "codex"]),
	).toEqual([{ paneId: "codex", provider: "codex", title: undefined }]);
	delete tab.panes.codex;
	expect(workspaceSessions(tab, ["codex"])).toEqual([]);
});

test("a restored single-pane group retains its name until the pane has its own", () => {
	const tab = mixedTab();
	tab.panes = { codex: tab.panes.codex };
	expect(workspaceSessions(tab, ["codex"])[0].title).toBe("Product launch");
	tab.panes.codex.titleOverride = "Fix sign-in";
	expect(workspaceSessions(tab, ["codex"])[0].title).toBe("Fix sign-in");
});
