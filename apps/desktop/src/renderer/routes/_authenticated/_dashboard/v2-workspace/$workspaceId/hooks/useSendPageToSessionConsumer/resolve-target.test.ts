import { describe, expect, it } from "bun:test";
import { resolveTarget, targetErrorMessage } from "./resolve-target";

describe("resolveTarget", () => {
	it("prefers the focused session pane", () => {
		// An explicit choice the user just made beats anything inferred from the
		// rest of the layout.
		expect(
			resolveTarget({
				activeSessionPaneId: "b",
				allSessionPaneIds: ["a", "b", "c"],
			}),
		).toEqual({ paneId: "b" });
	});

	it("uses the only session pane when nothing is focused", () => {
		expect(resolveTarget({ allSessionPaneIds: ["only"] })).toEqual({
			paneId: "only",
		});
	});

	it("refuses to guess between several unfocused sessions", () => {
		// Picking the first would be a coin flip dressed as a decision, and a
		// screenshot in the wrong conversation still looks like it worked — the
		// failure is silent, so it has to be refused loudly.
		expect(resolveTarget({ allSessionPaneIds: ["a", "b"] })).toEqual({
			error: "ambiguous",
		});
	});

	it("says so when there is no session at all", () => {
		expect(resolveTarget({ allSessionPaneIds: [] })).toEqual({
			error: "none-open",
		});
	});

	it("gives each refusal an actionable message", () => {
		// The two refusals need different fixes, so they must not share wording.
		expect(targetErrorMessage("none-open")).not.toBe(
			targetErrorMessage("ambiguous"),
		);
		expect(targetErrorMessage("none-open")).toContain("Open");
		expect(targetErrorMessage("ambiguous")).toContain("Click");
	});
});
