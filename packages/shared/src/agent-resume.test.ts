import { describe, expect, test } from "bun:test";
import {
	AGENT_RESUME_SYNTAX,
	formatAgentResumeCommand,
	isResumableAgentId,
} from "./agent-resume";

describe("isResumableAgentId", () => {
	test("only the two agents with a resume CLI", () => {
		expect(isResumableAgentId("claude")).toBe(true);
		expect(isResumableAgentId("codex")).toBe(true);
		// Everything else respawns as a plain shell rather than guessing syntax.
		expect(isResumableAgentId("gemini")).toBe(false);
		expect(isResumableAgentId("amp")).toBe(false);
		expect(isResumableAgentId("")).toBe(false);
	});
});

describe("formatAgentResumeCommand", () => {
	test("builds each agent's own syntax", () => {
		expect(formatAgentResumeCommand("claude", "abc-123")).toBe(
			"claude --resume abc-123",
		);
		expect(formatAgentResumeCommand("codex", "abc-123")).toBe(
			"codex resume abc-123",
		);
	});

	test("claude can fork a conversation", () => {
		expect(formatAgentResumeCommand("claude", "abc-123", { fork: true })).toBe(
			"claude --resume abc-123 --fork-session",
		);
	});

	test("codex has NO fork, and refuses rather than resuming in place", () => {
		// Quietly downgrading a fork to a plain resume would put a second writer
		// on a live session — the exact hazard the caller asked to avoid.
		expect(
			formatAgentResumeCommand("codex", "abc-123", { fork: true }),
		).toBeNull();
	});

	test("an unknown agent or a missing id yields nothing", () => {
		expect(formatAgentResumeCommand("gemini", "abc-123")).toBeNull();
		expect(formatAgentResumeCommand("claude", "")).toBeNull();
	});
});

describe("AGENT_RESUME_SYNTAX", () => {
	test("records the configured-args asymmetry rather than hiding it", () => {
		// Claude replays a user's configured launch args before --resume; Codex
		// does not, because its configured command carries approval/sandbox flags
		// and replaying them ahead of a `resume` subcommand is untested
		// behaviour. This predates the shared module and is preserved on purpose.
		expect(AGENT_RESUME_SYNTAX.claude.replayConfiguredArgs).toBe(true);
		expect(AGENT_RESUME_SYNTAX.codex.replayConfiguredArgs).toBe(false);
	});
});
