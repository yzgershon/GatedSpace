import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	acquireSessionLock,
	listHeldSessionIds,
	readSessionLock,
	releaseSessionLock,
} from "./session-lock";

const alive = () => true;
const dead = () => false;

let dir: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "session-lock-"));
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

describe("acquireSessionLock", () => {
	it("takes a free id", () => {
		expect(
			acquireSessionLock(dir, "sess-1", { pid: 100, kind: "pane" }, alive),
		).toEqual({ ok: true });
		expect(readSessionLock(dir, "sess-1")?.pid).toBe(100);
	});

	it("refuses an id a live process in another pid holds", () => {
		// The whole point: this is the ACP session in the host service.
		acquireSessionLock(dir, "sess-1", { pid: 100, kind: "acp" }, alive);
		const result = acquireSessionLock(
			dir,
			"sess-1",
			{ pid: 200, kind: "pane" },
			alive,
		);
		expect(result.ok).toBe(false);
		if (!result.ok)
			expect(result.heldBy).toMatchObject({ pid: 100, kind: "acp" });
	});

	it("steals a lock whose holder is gone", () => {
		// A crashed process must not block a legitimate resume forever — the same
		// rule that scopes resume-claim to keys that are actually live.
		acquireSessionLock(dir, "sess-1", { pid: 100, kind: "pane" }, dead);
		expect(
			acquireSessionLock(dir, "sess-1", { pid: 200, kind: "pane" }, dead),
		).toEqual({ ok: true });
		expect(readSessionLock(dir, "sess-1")?.pid).toBe(200);
	});

	it("is re-entrant for the same pid", () => {
		// A mode change respawns the session under the same key with --resume.
		// Deadlocking against ourselves would break that outright.
		acquireSessionLock(dir, "sess-1", { pid: 100, kind: "pane" }, alive);
		expect(
			acquireSessionLock(dir, "sess-1", { pid: 100, kind: "pane" }, alive),
		).toEqual({ ok: true });
	});

	it("steals a malformed lock rather than blocking on it", () => {
		writeFileSync(join(dir, "sess-1.lock"), "not json at all", "utf8");
		expect(
			acquireSessionLock(dir, "sess-1", { pid: 200, kind: "pane" }, alive),
		).toEqual({ ok: true });
		expect(readSessionLock(dir, "sess-1")?.pid).toBe(200);
	});

	it("creates the lock directory on demand", () => {
		const nested = join(dir, "does", "not", "exist");
		expect(
			acquireSessionLock(nested, "sess-1", { pid: 100, kind: "pane" }, alive),
		).toEqual({ ok: true });
	});

	it("allows an id that cannot be a safe filename, without writing one", () => {
		// A traversal-shaped id must never place a file outside the lock dir. It
		// goes unguarded rather than unsafe — the id is not one the CLI produces.
		expect(
			acquireSessionLock(
				dir,
				"../../escape",
				{ pid: 100, kind: "pane" },
				alive,
			),
		).toEqual({ ok: true });
		expect(existsSync(join(dir, "..", "..", "escape.lock"))).toBe(false);
	});

	it("does not block on different ids", () => {
		acquireSessionLock(dir, "sess-1", { pid: 100, kind: "pane" }, alive);
		expect(
			acquireSessionLock(dir, "sess-2", { pid: 200, kind: "pane" }, alive),
		).toEqual({ ok: true });
	});
});

describe("releaseSessionLock", () => {
	it("drops our own claim", () => {
		acquireSessionLock(dir, "sess-1", { pid: 100, kind: "pane" }, alive);
		releaseSessionLock(dir, "sess-1", 100);
		expect(readSessionLock(dir, "sess-1")).toBe(null);
	});

	it("refuses to release a lock another process owns", () => {
		// A dying session flushing a late release must not unlock the successor
		// that already took the id.
		acquireSessionLock(dir, "sess-1", { pid: 200, kind: "acp" }, alive);
		releaseSessionLock(dir, "sess-1", 100);
		expect(readSessionLock(dir, "sess-1")?.pid).toBe(200);
	});

	it("is a no-op when nothing is held", () => {
		expect(() => releaseSessionLock(dir, "sess-1", 100)).not.toThrow();
	});

	it("lets the id be taken again afterwards", () => {
		acquireSessionLock(dir, "sess-1", { pid: 100, kind: "pane" }, alive);
		releaseSessionLock(dir, "sess-1", 100);
		expect(
			acquireSessionLock(dir, "sess-1", { pid: 200, kind: "pane" }, alive),
		).toEqual({ ok: true });
	});
});

describe("listHeldSessionIds", () => {
	it("returns nothing when the directory has never existed", () => {
		expect(listHeldSessionIds(join(dir, "nope"), alive)).toEqual([]);
	});

	it("lists ids held by live holders, from either process", () => {
		acquireSessionLock(dir, "sess-pane", { pid: 100, kind: "pane" }, alive);
		acquireSessionLock(dir, "sess-acp", { pid: 200, kind: "acp" }, alive);
		expect(listHeldSessionIds(dir, alive).sort()).toEqual([
			"sess-acp",
			"sess-pane",
		]);
	});

	it("omits ids whose holder is gone", () => {
		// A crashed holder's id is legitimately resumable. Listing it would grey
		// out a session the user can actually open.
		acquireSessionLock(dir, "sess-1", { pid: 100, kind: "pane" }, alive);
		expect(listHeldSessionIds(dir, dead)).toEqual([]);
	});

	it("ignores unrelated files and malformed locks", () => {
		writeFileSync(join(dir, "notes.txt"), "ignore me", "utf8");
		writeFileSync(join(dir, "broken.lock"), "not json", "utf8");
		acquireSessionLock(dir, "sess-1", { pid: 100, kind: "pane" }, alive);
		expect(listHeldSessionIds(dir, alive)).toEqual(["sess-1"]);
	});

	it("drops an id once it is released", () => {
		acquireSessionLock(dir, "sess-1", { pid: 100, kind: "pane" }, alive);
		releaseSessionLock(dir, "sess-1", 100);
		expect(listHeldSessionIds(dir, alive)).toEqual([]);
	});
});

describe("readSessionLock", () => {
	it("returns null for a free id", () => {
		expect(readSessionLock(dir, "sess-1")).toBe(null);
	});

	it("records who took it and when", () => {
		acquireSessionLock(
			dir,
			"sess-1",
			{ pid: 100, kind: "acp", at: 1234 },
			alive,
		);
		expect(readSessionLock(dir, "sess-1")).toEqual({
			pid: 100,
			kind: "acp",
			at: 1234,
		});
		// Written as plain JSON so a stuck lock is readable by a human.
		expect(
			JSON.parse(readFileSync(join(dir, "sess-1.lock"), "utf8")),
		).toMatchObject({
			pid: 100,
		});
	});
});
