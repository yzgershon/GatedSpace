/**
 * trpc router for VS Code-style Claude Code session panes (1.16).
 *
 * Bridges the renderer to the main-process session manager: start/send/
 * interrupt/stop mutations, and a `stream` subscription that forwards the
 * transport's typed protocol events (observable over the manager's per-key
 * EventEmitter — same pattern as the browser console stream). The renderer
 * consumes these via the electronTrpcClient PROXY, never electronTrpc hooks
 * inside the workspace tree (avoids the "No procedure found" context hijack).
 */
import { observable } from "@trpc/server/observable";
import { getSessionCost } from "main/lib/claude-session/cost-store";
import { claudeSessionManager } from "main/lib/claude-session/session-manager";
import { loadSessionTranscript } from "main/lib/claude-session/transcript";
import { resolveActiveConfigDir } from "main/lib/claude-session/transport";
import type { ClaudeStreamEvent } from "shared/claude-session/events";
import { z } from "zod";
import { publicProcedure, router } from "../..";

const startInput = z.object({
	workspaceId: z.string().optional(),
	fast: z.boolean().optional(),
	key: z.string(),
	cwd: z.string(),
	model: z.string().optional(),
	permissionMode: z
		.enum(["manual", "acceptEdits", "plan", "bypassPermissions"])
		.optional(),
	resumeSessionId: z.string().optional(),
	/** Resume into a copy under a fresh session id, leaving the original alone. */
	forkSession: z.boolean().optional(),
	configDir: z.string().optional(),
	/** From the user's Claude agent preset; sanitized before it reaches argv. */
	binary: z.string().optional(),
	extraArgs: z.array(z.string()).optional(),
	env: z.record(z.string(), z.string()).optional(),
});

export const createClaudeSessionRouter = () => {
	return router({
		start: publicProcedure.input(startInput).mutation(({ input }) => {
			/*
			 * RESOLVE THE ACCOUNT HERE, AND HAND IT BACK.
			 *
			 * The transport used to do `configDir ?? resolveActiveConfigDir()`
			 * internally, so a pane that had never been swapped never learned which
			 * account it actually got. The renderer filled that gap by displaying
			 * the CURRENT global default — which is right at spawn and drifts the
			 * moment the default changes, so changing accounts from the profile
			 * menu renamed the chip on a pane whose process had not moved at all.
			 * That is the whole "the front end switched but the back end didn't"
			 * complaint.
			 *
			 * Resolving in one place and returning it means the pane can record
			 * what it is really running on, instead of inferring it.
			 */
			const configDir = input.configDir ?? resolveActiveConfigDir();
			claudeSessionManager.start(input.key, {
				workspaceId: input.workspaceId,
				cwd: input.cwd,
				fast: input.fast,
				model: input.model,
				permissionMode: input.permissionMode,
				resumeSessionId: input.resumeSessionId,
				forkSession: input.forkSession,
				configDir,
				binary: input.binary,
				extraArgs: input.extraArgs,
				env: input.env,
			});
			return { started: true, configDir };
		}),

		/**
		 * Respawn with new options, keeping the transcript. Used for permission
		 * mode changes, which have no slash command — pass the live session id as
		 * `resumeSessionId` so the conversation carries over.
		 */
		restart: publicProcedure.input(startInput).mutation(({ input }) => {
			// Same resolution as `start`, for the same reason: a restart that falls
			// back to the default has to say which account that turned out to be.
			const configDir = input.configDir ?? resolveActiveConfigDir();
			claudeSessionManager.restart(input.key, {
				workspaceId: input.workspaceId,
				cwd: input.cwd,
				fast: input.fast,
				model: input.model,
				permissionMode: input.permissionMode,
				resumeSessionId: input.resumeSessionId,
				forkSession: input.forkSession,
				configDir,
				binary: input.binary,
				extraArgs: input.extraArgs,
				env: input.env,
			});
			return { restarted: true, configDir };
		}),

		send: publicProcedure
			.input(
				z.object({
					key: z.string(),
					text: z.string(),
					/** Control messages (e.g. `/effort high`) don't echo into the UI. */
					silent: z.boolean().optional(),
					/**
					 * Pasted or dropped images, base64 with no data: prefix. They become
					 * Anthropic image content blocks ahead of the text on stdin.
					 */
					images: z
						.array(
							z.object({
								name: z.string(),
								mediaType: z.string(),
								width: z.number().optional(),
								height: z.number().optional(),
								data: z.string(),
							}),
						)
						.optional(),
				}),
			)
			.mutation(({ input }) => {
				claudeSessionManager.send(
					input.key,
					input.text,
					input.silent ?? false,
					input.images ?? [],
				);
				return { ok: true };
			}),

		/**
		 * Run a LOCAL slash command in the live session and hand back its reply,
		 * with none of it entering the conversation.
		 *
		 * Restricted to commands the CLI answers itself — they cost no turn, and an
		 * open allowlist would let the UI quietly run anything as the user. These
		 * have to execute in the live session rather than a throwaway one because
		 * their answers describe THIS session: a one-shot `/context` reported 23.6k
		 * against a conversation actually at 377k.
		 */
		runCommand: publicProcedure
			.input(
				z.object({
					key: z.string(),
					// An allowlist, not free text: this runs as the user in their live
					// session, and `/model <id>` is the one that takes an argument. The
					// id shape is deliberately narrow — the CLI's own list is words,
					// digits, dashes and a `[1m]` suffix.
					command: z
						.string()
						.regex(
							/^\/(?:(context|usage|model)(\s+[\w.[\]-]+)?|fast (on|off))$/,
						),
				}),
			)
			.mutation(({ input }) =>
				claudeSessionManager.runCommand(input.key, input.command),
			),

		answerPermission: publicProcedure
			.input(z.object({ key: z.string(), id: z.string(), allow: z.boolean() }))
			.mutation(({ input }) => {
				claudeSessionManager.answerPermission(input.key, input.id, input.allow);
				return { ok: true };
			}),

		interrupt: publicProcedure
			.input(z.object({ key: z.string() }))
			.mutation(({ input }) => {
				claudeSessionManager.interrupt(input.key);
				return { ok: true };
			}),

		stop: publicProcedure
			.input(z.object({ key: z.string() }))
			.mutation(({ input }) => {
				claudeSessionManager.stop(input.key);
				return { ok: true };
			}),

		/**
		 * Stored history for a session id, folded by the renderer before it
		 * resubscribes. This is what a pane shows after the app restarts — the
		 * in-memory replay buffer dies with the process, the transcript doesn't.
		 */
		history: publicProcedure
			.input(z.object({ sessionId: z.string() }))
			.query(({ input }) => loadSessionTranscript(input.sessionId)),

		/**
		 * What this conversation has cost in total, across every process that has
		 * served it.
		 *
		 * Separate from `history` because it cannot come from the transcript: the
		 * CLI writes no cost field there, and its per-result figure restarts at
		 * zero in each new process. Without this a restored pane began counting
		 * from nothing, which is what made the total appear to reset on every
		 * resume, restart and profile switch.
		 */
		cost: publicProcedure
			.input(z.object({ sessionId: z.string() }))
			.query(({ input }) => ({ costUsd: getSessionCost(input.sessionId) })),

		/**
		 * Session ids live in a session pane right now. The recent-sessions list
		 * unions these with the host's terminal bindings — a session open here
		 * must never be offered as a plain resume, for the same reason the host
		 * refuses one: two writers destroy the newer transcript.
		 */
		liveSessionIds: publicProcedure.query(() =>
			claudeSessionManager.getLiveSessionIds(),
		),

		isRunning: publicProcedure
			.input(z.object({ key: z.string() }))
			.query(({ input }) => claudeSessionManager.isRunning(input.key)),

		/**
		 * Forward every protocol event for this session key to the renderer,
		 * replaying the buffered transcript first so a pane that just remounted
		 * (tab switch, window reload) rebuilds the whole conversation.
		 *
		 * The replay and the listener attach in the same synchronous tick, so no
		 * live event can slip through the gap between them.
		 */
		stream: publicProcedure
			.input(z.object({ key: z.string() }))
			.subscription(({ input }) => {
				return observable<ClaudeStreamEvent>((emit) => {
					for (const event of claudeSessionManager.getBufferedEvents(
						input.key,
					)) {
						emit.next(event);
					}
					const handler = (event: ClaudeStreamEvent) => emit.next(event);
					claudeSessionManager.on(`event:${input.key}`, handler);
					return () => {
						claudeSessionManager.off(`event:${input.key}`, handler);
					};
				});
			}),
	});
};
