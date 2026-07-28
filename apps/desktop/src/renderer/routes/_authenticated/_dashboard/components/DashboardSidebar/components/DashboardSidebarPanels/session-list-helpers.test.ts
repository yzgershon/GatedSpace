/**
 * The liveness rule, tested directly.
 *
 * This is the decision that destroyed a transcript twice when it was wrong, and
 * moving the list into the sidebar took away the workspace context that used to
 * supply it. The failure DIRECTION is the thing these lock down: unknown must
 * behave exactly like live.
 */
import { describe, expect, test } from "bun:test";
import {
	formatRelativeTime,
	liveSessionKeys,
	resumeCommandFor,
} from "./session-list-helpers";

describe("liveSessionKeys", () => {
	test("a terminal-held session is keyed by agent and session id", () => {
		const keys = liveSessionKeys(
			[{ agentId: "claude", agentSessionId: "abc" }],
			[],
		);
		expect(keys?.has("claude:abc")).toBe(true);
	});

	test("pane sessions count too — they never appear in host bindings", () => {
		// A session running in a pane is spawned by the desktop, so the host has
		// no binding for it. Missing this is how a pane session would have looked
		// plain-resumable.
		const keys = liveSessionKeys([], ["pane-session"]);
		expect(keys?.has("claude:pane-session")).toBe(true);
	});

	test("bindings without a session id are ignored, not keyed as empty", () => {
		const keys = liveSessionKeys(
			[{ agentId: "claude", agentSessionId: null }],
			[],
		);
		expect(keys?.size).toBe(0);
	});

	test("an unreachable host yields UNKNOWN, not an empty set", () => {
		// The whole point. An empty set means "nothing is live" and would license
		// a plain resume; null means "we couldn't check" and forces a fork.
		expect(liveSessionKeys(null, ["pane-session"])).toBeNull();
	});

	test("nothing live is a real answer when the host DID reply", () => {
		const keys = liveSessionKeys([], []);
		expect(keys).not.toBeNull();
		expect(keys?.size).toBe(0);
	});

	test("both sources merge rather than one replacing the other", () => {
		const keys = liveSessionKeys(
			[{ agentId: "codex", agentSessionId: "from-host" }],
			["from-pane"],
		);
		expect(keys?.has("codex:from-host")).toBe(true);
		expect(keys?.has("claude:from-pane")).toBe(true);
	});
});

describe("formatRelativeTime", () => {
	const now = 1_000_000_000_000;

	test("under a minute reads as now", () => {
		expect(formatRelativeTime(now - 30_000, now)).toBe("now");
	});

	test("minutes, hours, days, months", () => {
		expect(formatRelativeTime(now - 5 * 60_000, now)).toBe("5m");
		expect(formatRelativeTime(now - 3 * 3_600_000, now)).toBe("3h");
		expect(formatRelativeTime(now - 4 * 86_400_000, now)).toBe("4d");
		expect(formatRelativeTime(now - 90 * 86_400_000, now)).toBe("3mo");
	});

	test("a future timestamp clamps instead of going negative", () => {
		// Clock skew between machines is real, and "-3m ago" reads as a bug.
		expect(formatRelativeTime(now + 60_000, now)).toBe("now");
	});
});

describe("resumeCommandFor", () => {
	test("builds the CLI command for each provider", () => {
		expect(resumeCommandFor("claude", "abc-123", false)).toBe(
			"claude --resume abc-123",
		);
		expect(resumeCommandFor("codex", "abc-123", false)).toBe(
			"codex resume abc-123",
		);
	});

	test("refuses to offer a command for a LIVE session", () => {
		// Running a resume in a second place is the exact two-writer case that
		// destroyed transcripts on 7/18 and 7/19. The UI offers a fork instead,
		// and there must be nothing here to copy.
		expect(resumeCommandFor("claude", "abc-123", true)).toBeNull();
		expect(resumeCommandFor("codex", "abc-123", true)).toBeNull();
	});

	test("refuses when there is no session id", () => {
		expect(resumeCommandFor("claude", "", false)).toBeNull();
	});
});
