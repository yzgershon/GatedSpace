import {
	cancelFlow,
	startFlow,
	stopFlow,
} from "main/lib/flow-dictation/service";
import { z } from "zod";
import { publicProcedure, router } from "..";

export const createFlowDictationRouter = () =>
	router({
		start: publicProcedure
			.input(z.object({ key: z.string().min(1).max(256) }))
			.mutation(({ input }) => startFlow(input.key)),
		stop: publicProcedure
			.input(z.object({ key: z.string().min(1).max(256) }))
			.mutation(({ input }) => stopFlow(input.key)),
		cancel: publicProcedure
			.input(z.object({ key: z.string().min(1).max(256) }))
			.mutation(({ input }) => cancelFlow(input.key)),
	});
