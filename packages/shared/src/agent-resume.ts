/**
 * How each agent CLI is asked to reattach to an existing conversation.
 *
 * This knowledge was encoded in two unrelated places — `buildAgentResumeCommand`
 * in host-service (used when a PTY dies out from under a binding) and the
 * sidebar's `resumeCommandFor` (used to hand the user a command to paste). Two
 * copies of "how do you resume Codex" is one copy too many: they can disagree,
 * and the second one to be written is the one nobody updates.
 *
 * Declared as data next to the agent catalog, so adding resume support for an
 * agent is an entry rather than a branch in however many call sites exist by
 * then.
 *
 * NOT included: whether resuming is *safe* right now. That depends on whether
 * something else already holds the session — a live second writer silently
 * destroys the newer transcript, which happened on 7/18 and again on 7/19 — and
 * it is the caller's job to establish. This module only knows syntax.
 */

/** Agents whose CLI can reattach to a prior conversation by id. */
export type ResumableAgentId = "claude" | "codex";

export interface AgentResumeSyntax {
	/** Base executable, before any user-configured launch args. */
	command: string;
	/**
	 * Builds the argument list that follows the command and its configured args.
	 * `fork` asks for a copy under a new id rather than reattaching in place.
	 */
	args(sessionId: string, options?: { fork?: boolean }): string[] | null;
	/**
	 * Whether a user's configured launch args are replayed before the resume
	 * args.
	 *
	 * Claude does; Codex does not. That asymmetry predates this module and is
	 * preserved deliberately rather than tidied: Codex's configured command
	 * carries approval/sandbox flags, and replaying them ahead of a `resume`
	 * subcommand is a change in behaviour nobody has tested. Encoded here so the
	 * difference is visible instead of hiding in a branch.
	 */
	replayConfiguredArgs: boolean;
}

export const AGENT_RESUME_SYNTAX: Record<ResumableAgentId, AgentResumeSyntax> =
	{
		claude: {
			command: "claude",
			args: (sessionId, options) => [
				"--resume",
				sessionId,
				// Claude can branch a conversation; Codex cannot.
				...(options?.fork ? ["--fork-session"] : []),
			],
			replayConfiguredArgs: true,
		},
		codex: {
			command: "codex",
			// No fork mode upstream, so a fork request has no valid syntax and must
			// fail rather than silently resume in place — which would be the exact
			// two-writer hazard the caller asked to avoid.
			args: (sessionId, options) =>
				options?.fork ? null : ["resume", sessionId],
			replayConfiguredArgs: false,
		},
	};

export function isResumableAgentId(id: string): id is ResumableAgentId {
	return id === "claude" || id === "codex";
}

/**
 * The full command string for a plain terminal, using the default executable.
 *
 * For the in-app path, prefer composing from AGENT_RESUME_SYNTAX so a
 * user-configured command and args are honoured.
 */
export function formatAgentResumeCommand(
	agentId: string,
	sessionId: string,
	options?: { fork?: boolean },
): string | null {
	if (!isResumableAgentId(agentId) || !sessionId) return null;
	const syntax = AGENT_RESUME_SYNTAX[agentId];
	const args = syntax.args(sessionId, options);
	if (!args) return null;
	return [syntax.command, ...args].join(" ");
}
