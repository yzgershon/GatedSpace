import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	mergePinnedCodexSessions,
	PinnedCodexSessions,
} from "./pinned-sessions";

test("pinning is idempotent, persists original identity and never edits a rollout", () => {
	const dir = mkdtempSync(join(tmpdir(), "codex-pins-"));
	try {
		const file = join(dir, "pins.json");
		const pins = new PinnedCodexSessions(file);
		const session = {
			sessionId: crypto.randomUUID(),
			title: "Project",
			cwd: "C:/Dev",
			lastModified: 123,
		};
		pins.set(session, true);
		pins.set({ ...session, title: "Renamed" }, true);
		expect(new PinnedCodexSessions(file).read()).toEqual([
			{ ...session, title: "Renamed" },
		]);
		pins.set(session, false);
		expect(pins.read()).toEqual([]);
		writeFileSync(file, "broken");
		expect(() => pins.set(session, true)).toThrow("preserved");
		expect(readFileSync(file, "utf8")).toBe("broken");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
test("pins survive the recent-list limit, retain chosen titles and filter correctly", () => {
	const a = {
		sessionId: crypto.randomUUID(),
		title: "filtrsoft",
		cwd: "C:/Dev",
		lastModified: 123,
	};
	const b = { ...a, sessionId: crypto.randomUUID(), title: "Jarvis" };
	const recent = [
		{ ...a, title: "Raw first prompt", lastModified: 456, contextTokens: 20 },
	];
	const result = mergePinnedCodexSessions(recent, [a, b]);
	expect(result).toHaveLength(2);
	expect(result[0]).toMatchObject({
		title: "filtrsoft",
		lastModified: 456,
		contextTokens: 20,
		pinned: true,
	});
	expect(mergePinnedCodexSessions([], [a, b], "jarvis")).toEqual([
		{ ...b, pinned: true },
	]);
});
