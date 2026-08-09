import { shell } from "electron";
import { readAgentLastUserMessage } from "main/lib/agent-last-message";
import {
	applyTitleOverrides,
	type ClaudeSessionSummary,
	findSessionFiles,
	listClaudeSessions,
	MAX_SESSION_TITLE,
	setSessionTitleOverride,
} from "main/lib/claude-sessions";
import { searchSessionContent } from "main/lib/claude-sessions/search-content";
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
					// CodexSessionSummary is structurally identical. Overrides are keyed
					// by session id and provider-agnostic, so Codex gets them too.
					return applyTitleOverrides(listCodexSessions(limit));
				}
				return listClaudeSessions(limit);
			}),

		/**
		 * Session ids whose TRANSCRIPT contains the query.
		 *
		 * The sidebar filters titles itself and instantly; this is the other half,
		 * and it is the half that matters, because titles are generated from the
		 * first prompt and repeat constantly. Returns ids rather than summaries so
		 * the renderer merges them into the list it already has instead of
		 * reconciling two differently-shaped result sets.
		 *
		 * Scanning is capped on both axes — how many files, and how much of each —
		 * because this runs while the user types.
		 */
		searchContent: publicProcedure
			.input(
				z.object({
					// Two characters matches nearly everything and costs a full scan
					// to prove it. Below three, title filtering alone is better.
					query: z.string().min(3).max(200),
					provider: z.enum(["claude", "codex"]).optional(),
					limit: z.number().min(1).max(400).optional(),
				}),
			)
			.query(({ input }): string[] => {
				const limit = input.limit ?? 200;
				const candidates =
					input.provider === "codex"
						? listCodexSessions(limit)
						: listClaudeSessions(limit);
				return searchSessionContent(candidates, input.query, limit);
			}),

		/**
		 * Name a session for good, or pass null to hand it back to the generated
		 * title.
		 *
		 * Stored in a sidecar keyed by session id, NOT on the pane: a pane rename
		 * dies with the pane, which is why reopening a renamed session showed the
		 * model's title again.
		 */
		rename: publicProcedure
			.input(
				z.object({
					sessionId: z.string().min(8).max(64),
					title: z.string().max(MAX_SESSION_TITLE).nullable(),
				}),
			)
			.mutation(({ input }) => {
				setSessionTitleOverride(input.sessionId, input.title);
				return { ok: true } as const;
			}),

		/**
		 * Delete a session by sending its transcript to the OS trash.
		 *
		 * `shell.trashItem`, never `unlink`. A transcript is the only copy of a
		 * conversation and this project has already lost some; a one-click
		 * unrecoverable delete in a hover affordance is how that happens again.
		 * The Recycle Bin makes a misclick a nuisance instead of a loss.
		 *
		 * The path is re-derived from the session list rather than trusted from
		 * the renderer. A path parameter straight to a delete is an arbitrary-file
		 * -delete primitive, and the renderer already has the id it needs.
		 */
		remove: publicProcedure
			.input(
				z.object({
					provider: z.enum(["claude", "codex"]),
					sessionId: z.string().min(8).max(64),
				}),
			)
			.mutation(async ({ input }) => {
				const sessions =
					input.provider === "codex"
						? listCodexSessions(200)
						: listClaudeSessions(200);
				const match = sessions.find((s) => s.sessionId === input.sessionId);
				if (!match) return { ok: false, reason: "not-found" } as const;
				/*
				 * Trash EVERY copy, not the one that happened to be listed.
				 *
				 * One conversation is typically three files, one per account config
				 * dir. Deleting only the displayed copy left the others, and the
				 * session came straight back on the next refresh — indistinguishable
				 * from a delete that silently failed.
				 *
				 * Codex keeps its own single file and has no account fan-out, so it
				 * still deletes exactly what was listed.
				 */
				const targets =
					input.provider === "codex"
						? [match.filePath]
						: findSessionFiles(input.sessionId);
				// A session that resolved to nothing on disk is already gone; saying
				// so is more honest than reporting success for a no-op.
				if (targets.length === 0) {
					return { ok: false, reason: "not-found" } as const;
				}
				try {
					for (const target of targets) {
						await shell.trashItem(target);
					}
				} catch (error) {
					return {
						ok: false,
						reason: error instanceof Error ? error.message : "trash-failed",
					} as const;
				}
				// The name outlives the transcript otherwise, and would reattach to
				// nothing — or to a future session that reused the id.
				setSessionTitleOverride(input.sessionId, null);
				return { ok: true } as const;
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
