import { describe, expect, it } from "bun:test";
import { AGENT_ACCENT_IDS, agentAccent } from "./agent-accent";

describe("agentAccent", () => {
	it("gives every known agent a colour", () => {
		for (const id of AGENT_ACCENT_IDS) {
			expect(agentAccent(id)).toMatch(/^#[0-9a-f]{6}$/i);
		}
	});

	it("gives nothing to a pane with no agent", () => {
		// A plain shell keeps the neutral header. Returning grey instead would
		// imply an agent whose colour failed to load, which is worse than the
		// honest absence of one.
		expect(agentAccent(undefined)).toBeUndefined();
		expect(agentAccent("")).toBeUndefined();
	});

	it("gives nothing to an agent it does not know", () => {
		// A user-defined agent handed a generated hue would be indistinguishable
		// from a built-in one, and the entire point is that the colour means
		// something specific.
		expect(agentAccent("some-custom-agent")).toBeUndefined();
	});

	it("keeps the colours distinct from each other", () => {
		// Two agents sharing a colour defeats the feature precisely when it
		// matters — several agent panes open side by side.
		const colours = AGENT_ACCENT_IDS.map((id) => agentAccent(id));
		expect(new Set(colours).size).toBe(colours.length);
	});
});
