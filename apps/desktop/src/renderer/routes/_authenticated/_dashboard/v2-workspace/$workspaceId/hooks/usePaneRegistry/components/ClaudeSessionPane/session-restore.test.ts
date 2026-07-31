/**
 * The bug being pinned down: reopening the app on a saved session showed the
 * "Start a Claude Code session" empty state — openers and all — for a
 * conversation that already had history, then replaced it with the real
 * transcript a moment later. An empty timeline is not the same thing as a new
 * session, and this is where the two are told apart.
 */
import { describe, expect, test } from "bun:test";
import { isRestoringTranscript } from "./session-restore";

describe("isRestoringTranscript", () => {
	test("a brand new pane is not restoring — it really is empty", () => {
		expect(
			isRestoringTranscript({ restore: null, resumeSessionId: undefined }),
		).toBe(false);
	});

	test("a resumed pane restores from its very first frame", () => {
		// `restore` is still null here: ensureSession runs in an effect, so the
		// store has not been told anything yet when this frame paints. Getting
		// this wrong shows one frame of the wrong state, which is what a user
		// perceives as a flash.
		expect(
			isRestoringTranscript({ restore: null, resumeSessionId: "abc-123" }),
		).toBe(true);
	});

	test("stays restoring while the transcript is being read", () => {
		expect(
			isRestoringTranscript({ restore: "loading", resumeSessionId: "abc-123" }),
		).toBe(true);
	});

	test("stops once the transcript has settled", () => {
		// Including when the resumed conversation turned out to be genuinely
		// empty: the openers are correct then, and a skeleton would hang forever.
		expect(
			isRestoringTranscript({ restore: "done", resumeSessionId: "abc-123" }),
		).toBe(false);
		expect(
			isRestoringTranscript({ restore: "done", resumeSessionId: undefined }),
		).toBe(false);
	});
});
