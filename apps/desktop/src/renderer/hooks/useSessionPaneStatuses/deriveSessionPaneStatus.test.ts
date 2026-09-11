import { describe, expect, it } from "bun:test";
import type { SessionActivity } from "renderer/stores/session-activity";
import { deriveSessionPaneStatus } from "./deriveSessionPaneStatus";

const activity = (
	status: SessionActivity["status"],
	turnKey?: string,
): SessionActivity => ({ status, turnKey });

describe("deriveSessionPaneStatus", () => {
	it("shows nothing for a pane with no session yet", () => {
		expect(
			deriveSessionPaneStatus({ activity: undefined, seenTurn: undefined }),
		).toBe("idle");
	});

	it("is working while the model is streaming", () => {
		expect(
			deriveSessionPaneStatus({
				activity: activity("streaming"),
				seenTurn: undefined,
			}),
		).toBe("working");
	});

	/**
	 * `streaming` reports something happening right now, not something missed,
	 * so a stale seen mark from the previous turn must not put the dot out
	 * while the model is mid-answer.
	 */
	it("stays working even when a previous turn was already seen", () => {
		expect(
			deriveSessionPaneStatus({
				activity: activity("streaming", "turn-1"),
				seenTurn: "turn-1",
			}),
		).toBe("working");
	});

	it("is review once a turn finishes unseen", () => {
		expect(
			deriveSessionPaneStatus({
				activity: activity("done", "turn-1"),
				seenTurn: undefined,
			}),
		).toBe("review");
	});

	it("is error when the turn died unseen", () => {
		expect(
			deriveSessionPaneStatus({
				activity: activity("error", "turn-1"),
				seenTurn: undefined,
			}),
		).toBe("error");
	});

	it("clears once that exact turn has been seen", () => {
		expect(
			deriveSessionPaneStatus({
				activity: activity("done", "turn-1"),
				seenTurn: "turn-1",
			}),
		).toBe("idle");
		expect(
			deriveSessionPaneStatus({
				activity: activity("error", "turn-1"),
				seenTurn: "turn-1",
			}),
		).toBe("idle");
	});

	/** The whole point of keying on the turn rather than on the pane. */
	it("lights again for the NEXT turn after an earlier one was seen", () => {
		expect(
			deriveSessionPaneStatus({
				activity: activity("done", "turn-2"),
				seenTurn: "turn-1",
			}),
		).toBe("review");
	});

	/**
	 * A transcript restored from disk folds to `idle`, but a fold that ends
	 * mid-turn can still arrive settled with nothing finished behind it. That
	 * is history, not a completion the user missed.
	 */
	it("shows nothing for a settled status with no finished turn", () => {
		expect(
			deriveSessionPaneStatus({
				activity: activity("done", undefined),
				seenTurn: undefined,
			}),
		).toBe("idle");
	});

	it("shows nothing for an idle session", () => {
		expect(
			deriveSessionPaneStatus({
				activity: activity("idle", "turn-1"),
				seenTurn: undefined,
			}),
		).toBe("idle");
	});
});
