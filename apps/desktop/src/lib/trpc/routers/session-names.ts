import { observable } from "@trpc/server/observable";
import { readNewAgentFirstMessage } from "main/lib/agent-last-message/agent-last-message";
import { sessionNames } from "main/lib/session-names";
import type { SessionNamesSnapshot } from "shared/session-names";
import { terminalNamingPrompt } from "shared/terminal-naming";
import { z } from "zod";
import { publicProcedure, router } from "..";

const ref = z
	.object({
		provider: z.enum(["claude", "codex", "terminal"]),
		id: z.string().max(200).optional(),
		key: z.string().max(200).optional(),
	})
	.refine((r) => !!(r.id || r.key));
export const createSessionNamesRouter = () =>
	router({
		watch: publicProcedure.subscription(() =>
			observable<SessionNamesSnapshot>((emit) => {
				const send = (snapshot: SessionNamesSnapshot) => emit.next(snapshot);
				sessionNames.on("change", send);
				send(sessionNames.read());
				return () => {
					sessionNames.off("change", send);
				};
			}),
		),
		rename: publicProcedure
			.input(z.object({ ref, title: z.string().max(120).nullable() }))
			.mutation(({ input }) => {
				sessionNames.rename(input.ref, input.title);
				return sessionNames.read();
			}),
		terminalStarted: publicProcedure
			.input(
				z.object({
					id: z.string().min(1),
					prompt: z.string().max(12_000).optional(),
					command: z.string().max(12_000).optional(),
				}),
			)
			.mutation(({ input }) => {
				const target = { provider: "terminal", id: input.id } as const;
				sessionNames.startTerminal(input.id);
				const prompt =
					input.prompt?.trim() || terminalNamingPrompt(input.command ?? "");
				if (prompt) sessionNames.firstPrompt(target, prompt);
			}),
		terminalAgent: publicProcedure
			.input(
				z.object({
					id: z.string().min(1),
					provider: z.enum(["claude", "codex"]),
					sessionId: z.string().min(8).max(64),
				}),
			)
			.mutation(({ input }) => {
				const startedAt = sessionNames.terminalStartedAt(input.id);
				const prompt = startedAt
					? readNewAgentFirstMessage(input.provider, input.sessionId, startedAt)
					: null;
				if (startedAt && prompt === null) return { pending: true };
				sessionNames.bindTerminal(
					input.id,
					input.provider,
					input.sessionId,
					!!prompt,
				);
				if (prompt === "") sessionNames.finishTerminal(input.id);
				if (prompt)
					sessionNames.firstPrompt(
						{ provider: input.provider, id: input.sessionId },
						prompt,
					);
				sessionNames.finishTerminal(input.id);
				return { pending: false };
			}),
		terminalPrompt: publicProcedure
			.input(
				z.object({ id: z.string().min(1), prompt: z.string().max(12_000) }),
			)
			.mutation(({ input }) =>
				sessionNames.firstPrompt(
					{ provider: "terminal", id: input.id },
					terminalNamingPrompt(input.prompt) ?? "",
				),
			),
	});
