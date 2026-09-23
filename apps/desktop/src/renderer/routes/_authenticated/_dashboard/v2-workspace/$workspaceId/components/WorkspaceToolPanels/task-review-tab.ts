import type { CodexTurnReview } from "shared/codex-session/review";
import type { createToolPanels } from "./tool-panel-store";

/** Reopen this task's snapshot without replacing unrelated tool tabs. */
export function openTaskReview(
	tools: ReturnType<typeof createToolPanels>,
	review: CodexTurnReview,
) {
	for (const tab of tools.store.getState().tabs) {
		const pane = Object.values(tab.panes).find(
			(pane) =>
				pane.kind === "codex-review" &&
				"review" in pane.data &&
				pane.data.review.id === review.id,
		);
		if (!pane) continue;
		tools.store.getState().setPaneData({ paneId: pane.id, data: { review } });
		tools.select(tab.id);
		return tab.id;
	}
	return tools.add("right", { kind: "codex-review", data: { review } });
}
