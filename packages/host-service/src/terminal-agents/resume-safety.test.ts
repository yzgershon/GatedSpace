import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	agentTranscriptExists,
	findLiveAgentSessionBinding,
	readAgentSessionCwd,
} from "./resume-safety";
import { TerminalAgentStore } from "./store";

function tmpHome(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "resume-safety-home-"));
}

const SESSION_ID = "11111111-2222-3333-4444-555555555555";

describe("agentTranscriptExists", () => {
	test("finds a claude transcript in the default config dir", () => {
		const home = tmpHome();
		const slugDir = path.join(home, ".claude", "projects", "C--repo");
		fs.mkdirSync(slugDir, { recursive: true });
		fs.writeFileSync(path.join(slugDir, `${SESSION_ID}.jsonl`), "{}\n");
		expect(agentTranscriptExists("claude", SESSION_ID, { home })).toBe(true);
		expect(
			agentTranscriptExists("claude", "not-a-real-session-id", { home }),
		).toBe(false);
	});

	test("finds a claude transcript in an account-profile config dir", () => {
		const home = tmpHome();
		const slugDir = path.join(home, ".claude-alt", "projects", "C--repo");
		fs.mkdirSync(slugDir, { recursive: true });
		fs.writeFileSync(path.join(slugDir, `${SESSION_ID}.jsonl`), "{}\n");
		fs.mkdirSync(path.join(home, ".superset"), { recursive: true });
		fs.writeFileSync(
			path.join(home, ".superset", "claude-profile.json"),
			JSON.stringify({
				profiles: { alt: { configDir: ".claude-alt" } },
			}),
		);
		expect(agentTranscriptExists("claude", SESSION_ID, { home })).toBe(true);
	});

	test("finds a codex rollout by filename suffix in the date tree", () => {
		const home = tmpHome();
		const dayDir = path.join(home, ".codex", "sessions", "2026", "07", "19");
		fs.mkdirSync(dayDir, { recursive: true });
		fs.writeFileSync(
			path.join(dayDir, `rollout-2026-07-19T10-00-00-${SESSION_ID}.jsonl`),
			"{}\n",
		);
		expect(agentTranscriptExists("codex", SESSION_ID, { home })).toBe(true);
		expect(agentTranscriptExists("codex", "missing-session-id", { home })).toBe(
			false,
		);
	});

	test("unknown agents never block", () => {
		expect(
			agentTranscriptExists("some-future-agent", SESSION_ID, {
				home: tmpHome(),
			}),
		).toBe(true);
	});
});

describe("readAgentSessionCwd", () => {
	test("reads the claude session's own directory", () => {
		const home = tmpHome();
		const slugDir = path.join(home, ".claude", "projects", "C--repo");
		fs.mkdirSync(slugDir, { recursive: true });
		fs.writeFileSync(
			path.join(slugDir, `${SESSION_ID}.jsonl`),
			`${JSON.stringify({ type: "summary" })}\n${JSON.stringify({
				type: "user",
				cwd: "C:\\Dev\\SecondBrain",
			})}\n`,
		);
		expect(readAgentSessionCwd("claude", SESSION_ID, { home })).toBe(
			"C:\\Dev\\SecondBrain",
		);
	});

	test("reads the codex session's directory from its nested payload", () => {
		const home = tmpHome();
		const dayDir = path.join(home, ".codex", "sessions", "2026", "07", "20");
		fs.mkdirSync(dayDir, { recursive: true });
		fs.writeFileSync(
			path.join(dayDir, `rollout-2026-07-20T10-00-00-${SESSION_ID}.jsonl`),
			`${JSON.stringify({
				type: "session_meta",
				payload: { cwd: "C:\\Dev\\superset" },
			})}\n`,
		);
		expect(readAgentSessionCwd("codex", SESSION_ID, { home })).toBe(
			"C:\\Dev\\superset",
		);
	});

	test("returns null when the session has no transcript", () => {
		expect(
			readAgentSessionCwd("claude", "missing-session-id", { home: tmpHome() }),
		).toBe(null);
	});

	test("survives a truncated trailing line", () => {
		const home = tmpHome();
		const slugDir = path.join(home, ".claude", "projects", "C--repo");
		fs.mkdirSync(slugDir, { recursive: true });
		fs.writeFileSync(
			path.join(slugDir, `${SESSION_ID}.jsonl`),
			`{"type":"user","cwd":"C:\\\\Dev\\\\SecondBrain"}\n{"type":"assist`,
		);
		expect(readAgentSessionCwd("claude", SESSION_ID, { home })).toBe(
			"C:\\Dev\\SecondBrain",
		);
	});
});

describe("findLiveAgentSessionBinding", () => {
	function storeWith(terminalId: string, agentSessionId: string) {
		const store = new TerminalAgentStore();
		store.recordEvent({
			terminalId,
			workspaceId: "ws-1",
			eventType: "Start",
			agentId: "claude",
			agentSessionId,
			occurredAt: Date.now(),
		});
		return store;
	}

	test("matches a live binding by agent and session id", () => {
		const store = storeWith("term-1", SESSION_ID);
		expect(
			findLiveAgentSessionBinding(store, "claude", SESSION_ID)?.terminalId,
		).toBe("term-1");
		expect(findLiveAgentSessionBinding(store, "codex", SESSION_ID)).toBe(
			undefined,
		);
		expect(findLiveAgentSessionBinding(store, "claude", "other-id")).toBe(
			undefined,
		);
	});

	test("excludes the caller's own terminal (respawn path)", () => {
		const store = storeWith("term-1", SESSION_ID);
		expect(
			findLiveAgentSessionBinding(store, "claude", SESSION_ID, "term-1"),
		).toBe(undefined);
	});
});
