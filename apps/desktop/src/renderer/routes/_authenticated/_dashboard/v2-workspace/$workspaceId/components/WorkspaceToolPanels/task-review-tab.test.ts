import { expect, test } from "bun:test";
import { buildTurnReview } from "shared/codex-session/review";
import { openTaskReview } from "./task-review-tab";
import { createToolPanels } from "./tool-panel-store";

test("task reviews reopen independently, preserve existing tabs and restore snapshots", () => {
	let saved = "";
	const options = {
		key: "review-test",
		storage: {
			getItem: () => saved,
			setItem: (_key: string, value: string) => {
				saved = value;
			},
		},
		createTerminal: async () => "terminal",
	};
	const tools = createToolPanels(options);
	const disconnect = tools.connect();
	const browser = tools.add("right", {
		kind: "browser",
		data: { url: "https://example.com" },
	});
	const review = (id: string) => {
		const value = buildTurnReview({
			id,
			turnId: id,
			cwd: "C:/work",
			items: [],
			diff: `diff --git a/${id}.ts b/${id}.ts\n--- a/${id}.ts\n+++ b/${id}.ts\n@@ -1 +1 @@\n-old\n+${id}`,
		});
		if (!value) throw Error("Fixture patch missing");
		return value;
	};
	const first = openTaskReview(tools, review("first"));
	const second = openTaskReview(tools, review("second"));
	expect(first).not.toBe(second);
	tools.setOpen("right", false);
	expect(
		openTaskReview(tools, { ...review("first"), selectedPath: "first.ts" }),
	).toBe(first);
	expect(tools.state.getState().right).toMatchObject({
		open: true,
		activeTabId: first,
	});
	expect(tools.store.getState().tabs).toHaveLength(3);
	expect(
		tools.store.getState().tabs.find((t) => t.id === browser),
	).toBeDefined();
	disconnect();
	const restored = createToolPanels(options);
	expect(restored.store.getState().tabs).toHaveLength(3);
	expect(
		JSON.stringify(restored.store.getState().tabs.find((t) => t.id === first)),
	).toContain("first.ts");
	expect(
		JSON.stringify(restored.store.getState().tabs.find((t) => t.id === first)),
	).not.toContain("second.ts");
});
