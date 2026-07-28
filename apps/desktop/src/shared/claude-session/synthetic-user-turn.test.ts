import { describe, expect, it } from "bun:test";
import { isSyntheticUserTurn } from "./synthetic-user-turn";

describe("isSyntheticUserTurn", () => {
	it("catches a background-task notification by its origin", () => {
		// The shape below is copied from a real transcript record. Metadata is the
		// discriminator, not the body.
		expect(
			isSyntheticUserTurn({
				origin: { kind: "task-notification" },
				message: { content: "<task-notification>\n<task-id>abc</task-id>" },
			}),
		).toBe(true);
	});

	it("catches one by content when the record predates origin", () => {
		expect(
			isSyntheticUserTurn({
				message: { content: "<task-notification>\n<status>completed</status>" },
			}),
		).toBe(true);
	});

	it("leaves a real prompt alone", () => {
		// Real prompts carry origin.kind "human", or nothing at all on older
		// records. Neither may be filtered — the prompt is the only record of what
		// was asked.
		expect(
			isSyntheticUserTurn({
				origin: { kind: "human" },
				message: { content: "ok lets continue" },
			}),
		).toBe(false);
		expect(
			isSyntheticUserTurn({ message: { content: "ok lets continue" } }),
		).toBe(false);
	});

	it("leaves a prompt that merely MENTIONS a notification alone", () => {
		// This exact conversation is the reason: asking about the bug means typing
		// the marker, and a body-first rule would have deleted the question.
		expect(
			isSyntheticUserTurn({
				origin: { kind: "human" },
				message: {
					content:
						"the <task-notification> block keeps showing up as my last message",
				},
			}),
		).toBe(false);
	});

	it("still catches the other machine-authored prefixes", () => {
		for (const content of [
			"<local-command-stdout>done</local-command-stdout>",
			"<command-name>/compact</command-name>",
			"<system-reminder>be careful</system-reminder>",
		]) {
			expect(isSyntheticUserTurn({ message: { content } })).toBe(true);
		}
	});

	it("honours the CLI's own bookkeeping flags", () => {
		expect(
			isSyntheticUserTurn({ isMeta: true, message: { content: "x" } }),
		).toBe(true);
		expect(
			isSyntheticUserTurn({
				isCompactSummary: true,
				message: { content: "x" },
			}),
		).toBe(true);
	});

	it("does not choke on a tool-result turn", () => {
		// Live user events carry block arrays rather than strings.
		expect(
			isSyntheticUserTurn({
				message: { content: [{ type: "tool_result", tool_use_id: "t1" }] },
			}),
		).toBe(false);
	});
});
