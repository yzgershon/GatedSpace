import { observable } from "@trpc/server/observable";
import {
	createEnsembleSession,
	ensembleService,
} from "main/lib/ensemble/service";
import { listBridgeWorkspaceTargets } from "main/lib/mobile-bridge/workspace-targets";
import {
	createEnsembleInput,
	ensembleProvider,
	memberInput,
} from "shared/ensemble";
import { z } from "zod";
import { publicProcedure, router } from "../..";

const id = z.object({ id: z.string().uuid() });
export const createEnsembleRouter = () =>
	router({
		snapshot: publicProcedure.query(async () => ({
			groups: ensembleService().list(),
			sessions: await ensembleService().transport.list(),
		})),
		workspaces: publicProcedure.query(() => listBridgeWorkspaceTargets()),
		create: publicProcedure
			.input(createEnsembleInput)
			.mutation(({ input }) => ensembleService().create(input)),
		createSession: publicProcedure
			.input(z.object({ provider: ensembleProvider, workspaceId: z.string() }))
			.mutation(({ input }) =>
				createEnsembleSession(input.provider, input.workspaceId),
			),
		control: publicProcedure
			.input(
				id.extend({ action: z.enum(["start", "pause", "resume", "stop"]) }),
			)
			.mutation(({ input }) =>
				ensembleService().control(input.id, input.action),
			),
		message: publicProcedure
			.input(id.extend({ to: z.string(), text: z.string().min(1).max(8000) }))
			.mutation(({ input }) =>
				ensembleService().message(input.id, input.to, input.text),
			),
		update: publicProcedure
			.input(
				id.extend({
					goal: z.string().min(5).max(8000).optional(),
					criteria: z.string().min(5).max(4000).optional(),
					maxMessages: z.number().int().min(4).max(100).optional(),
				}),
			)
			.mutation(({ input }) => ensembleService().update(input.id, input)),
		addMember: publicProcedure
			.input(id.extend({ member: memberInput }))
			.mutation(({ input }) =>
				ensembleService().addMember(input.id, { ...input.member, id: "" }),
			),
		removeMember: publicProcedure
			.input(id.extend({ memberId: z.string() }))
			.mutation(({ input }) =>
				ensembleService().removeMember(input.id, input.memberId),
			),
		resolve: publicProcedure
			.input(id.extend({ messageId: z.string().uuid(), retry: z.boolean() }))
			.mutation(({ input }) =>
				ensembleService().resolve(input.id, input.messageId, input.retry),
			),
		stream: publicProcedure.subscription(() =>
			observable<number>((emit) => {
				const engine = ensembleService();
				const handler = () => emit.next(Date.now());
				engine.on("change", handler);
				return () => {
					engine.off("change", handler);
				};
			}),
		),
	});
