import { readAgentLastUserMessage } from "main/lib/agent-last-message";
import {
	type ClaudeSessionSummary,
	listClaudeSessions,
} from "main/lib/claude-sessions";
import { listCodexSessions } from "main/lib/codex-sessions";
import { z } from "zod";
import { publicProcedure, router } from "..";

export type AgentSessionProvider = "claude" | "codex";

export const createClaudeSessionsRouter = () => {
	return router({
		list: publicProcedure
			.input(
				z
					.object({
						limit: z.number().min(1).max(100).optional(),
						provider: z.enum(["claude", "codex"]).optional(),
					})
					.optional(),
			)
			.query(({ input }): ClaudeSessionSummary[] => {
				const limit = input?.limit ?? 30;
				if (input?.provider === "codex") {
					// CodexSessionSummary is structurally identical.
					return listCodexSessions(limit);
				}
				return listClaudeSessions(limit);
			}),

		/** Latest user message of a session, for the terminal sticky-prompt bar. */
		lastUserText: publicProcedure
			.input(
				z.object({
					provider: z.enum(["claude", "codex"]),
					sessionId: z.string().min(8).max(64),
				}),
			)
			.query(({ input }) =>
				readAgentLastUserMessage(input.provider, input.sessionId),
			),
	});
};
