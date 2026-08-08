import { describe, expect, it } from "bun:test";
import { resolveResumeClaim } from "./resume-claim";

const allLive = () => true;
const noneLive = () => false;

describe("resolveResumeClaim", () => {
	it("claims the id at spawn, before init could confirm it", () => {
		// This is the whole point: ownership starts on intent, not on init.
		expect(resolveResumeClaim("pane-a", "sess-1", new Map(), allLive)).toEqual({
			claim: "sess-1",
		});
	});

	it("refuses a resume of an id a live pane already holds", () => {
		const owned = new Map([["pane-a", "sess-1"]]);
		expect(resolveResumeClaim("pane-b", "sess-1", owned, allLive)).toEqual({
			claim: null,
			blockedBy: "pane-a",
		});
	});

	it("closes the spawn-to-init window", () => {
		// pane-a claimed sess-1 on spawn and has NOT reported init yet. Before
		// claim-on-intent this returned unowned and both panes wrote to sess-1.
		const owned = new Map([["pane-a", "sess-1"]]);
		expect(resolveResumeClaim("pane-b", "sess-1", owned, allLive).claim).toBe(
			null,
		);
	});

	it("lets a key re-resume the id it already owns", () => {
		// A mode change restarts the process under the same key with --resume.
		const owned = new Map([["pane-a", "sess-1"]]);
		expect(resolveResumeClaim("pane-a", "sess-1", owned, allLive)).toEqual({
			claim: "sess-1",
		});
	});

	it("ignores ids held by keys that are no longer live", () => {
		// A dead session's leftover id must not block a legitimate resume.
		const owned = new Map([["pane-a", "sess-1"]]);
		expect(resolveResumeClaim("pane-b", "sess-1", owned, noneLive)).toEqual({
			claim: "sess-1",
		});
	});

	it("claims nothing when starting fresh, clearing a stale id on that key", () => {
		const owned = new Map([["pane-a", "sess-old"]]);
		expect(resolveResumeClaim("pane-a", undefined, owned, allLive)).toEqual({
			claim: null,
		});
	});

	it("doesn't confuse a different session id for a conflict", () => {
		const owned = new Map([["pane-a", "sess-1"]]);
		expect(resolveResumeClaim("pane-b", "sess-2", owned, allLive)).toEqual({
			claim: "sess-2",
		});
	});

	it("refuses an id a live ACP session in the host service holds", () => {
		// ACP writes to the same ~/.claude/projects transcripts the panes do, so
		// a holder outside this process destroys a transcript exactly like a
		// second pane would — and `owned` cannot see it.
		const held = new Set(["sess-acp"]);
		expect(
			resolveResumeClaim("pane-a", "sess-acp", new Map(), allLive, held),
		).toEqual({ claim: null, blockedByExternal: true });
	});

	it("names the pane when both a pane and an outside process hold it", () => {
		// "Already open in another pane" is the more actionable message, so the
		// local conflict wins the report. Either way the caller forks.
		const owned = new Map([["pane-a", "sess-1"]]);
		const held = new Set(["sess-1"]);
		expect(
			resolveResumeClaim("pane-b", "sess-1", owned, allLive, held),
		).toEqual({ claim: null, blockedBy: "pane-a" });
	});

	it("forks even when the holder is this key's own id", () => {
		// pane-a owns sess-1 AND an ACP session grabbed it. Re-resuming would put
		// two live writers on one transcript, so this is the one case where a key
		// does not get to re-resume what it already owns.
		const owned = new Map([["pane-a", "sess-1"]]);
		const held = new Set(["sess-1"]);
		expect(
			resolveResumeClaim("pane-a", "sess-1", owned, allLive, held),
		).toEqual({ claim: null, blockedByExternal: true });
	});

	it("lets an unrelated id through when something else is held outside", () => {
		const held = new Set(["sess-other"]);
		expect(
			resolveResumeClaim("pane-a", "sess-1", new Map(), allLive, held),
		).toEqual({ claim: "sess-1" });
	});
});
