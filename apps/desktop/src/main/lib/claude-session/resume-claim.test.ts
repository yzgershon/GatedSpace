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
});
