import type { SessionChangeSummary } from "../session-changes";
import { buildTurnReview } from "./review";
import type { CodexSessionState } from "./types";

export function codexTaskChanges(
	state?: CodexSessionState,
): SessionChangeSummary | null {
	if (!state) return null;
	const latestUser = state.items.findLast((item) => item.kind === "user");
	// A newly sent prompt can precede the server's turn-start notification.
	if (latestUser?.id.startsWith("local-user-") && !latestUser.turnId)
		return null;
	const turnId = state.status === "working" ? state.turnId : latestUser?.turnId;
	if (!turnId) return null;
	const review = buildTurnReview({
		id: turnId,
		turnId,
		cwd: state.cwd,
		items: state.items.filter((item) => item.turnId === turnId),
		diff: state.turns?.find((turn) => turn.id === turnId)?.diff,
	});
	return review
		? {
				files: review.files.length,
				added: review.added,
				removed: review.removed,
			}
		: null;
}
