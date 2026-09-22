import { observable } from "@trpc/server/observable";
import { codexSessionManager as manager } from "main/lib/codex-session/session-manager";
import type { CodexSessionState } from "shared/codex-session/types";
import { z } from "zod";
import { publicProcedure, router } from "../..";

const keyInput = z.object({ key: z.string().min(1).max(200) });
export const createCodexSessionRouter = () =>
	router({
		start: publicProcedure
			.input(
				keyInput.extend({
					workspaceId: z.string().optional(),
					cwd: z.string().min(1),
					model: z.string().optional(),
					resumeSessionId: z.string().optional(),
					forkSession: z.boolean().optional(),
				}),
			)
			.mutation(({ input }) => manager.start(input)),
		models: publicProcedure.query(() => manager.models()),
		account: publicProcedure.query(() => manager.account()),
		limits: publicProcedure
			.input(z.object({ model: z.string().optional() }).optional())
			.query(({ input }) => manager.limits(input?.model)),
		skills: publicProcedure
			.input(z.object({ cwd: z.string().min(1) }))
			.query(({ input }) => manager.skills(input.cwd)),
		command: publicProcedure
			.input(
				keyInput.extend({
					command: z.enum(["review", "compact"]),
					args: z.string().max(100_000).optional(),
				}),
			)
			.mutation(({ input }) =>
				manager.command(input.key, input.command, input.args),
			),
		liveSessionIds: publicProcedure.query(() => manager.liveIds()),
		send: publicProcedure
			.input(
				keyInput.extend({
					text: z.string().max(1_000_000),
					model: z.string(),
					effort: z.string(),
					plan: z.boolean().optional(),
					fast: z.boolean().optional(),
					permission: z.enum(["default", "read-only", "full-access"]),
					images: z
						.array(
							z
								.string()
								.max(15_000_000)
								.regex(/^data:image\/(png|jpeg|webp|gif);base64,/),
						)
						.max(8)
						.optional(),
				}),
			)
			.mutation(({ input }) => manager.send(input)),
		interrupt: publicProcedure
			.input(keyInput)
			.mutation(({ input }) => manager.interrupt(input.key)),
		close: publicProcedure
			.input(keyInput)
			.mutation(({ input }) => manager.close(input.key)),
		earlier: publicProcedure
			.input(keyInput)
			.mutation(({ input }) => manager.earlier(input.key)),
		answer: publicProcedure
			.input(
				keyInput.extend({
					id: z.string(),
					allow: z.boolean(),
					answers: z.record(z.string(), z.string()).optional(),
				}),
			)
			.mutation(({ input }) =>
				manager.answer(input.key, input.id, input.allow, input.answers),
			),
		stream: publicProcedure.input(keyInput).subscription(({ input }) =>
			observable<CodexSessionState>((emit) => {
				const listener = (state: CodexSessionState) => emit.next(state);
				manager.on(input.key, listener);
				const state = manager.get(input.key);
				if (state) emit.next(state);
				return () => {
					manager.off(input.key, listener);
				};
			}),
		),
	});
