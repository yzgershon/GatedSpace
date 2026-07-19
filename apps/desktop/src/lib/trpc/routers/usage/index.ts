import {
	getClaudeProfile,
	setClaudeProfileMode,
} from "main/lib/claude-profile";
import { computeUsageStats } from "main/lib/usage-stats";
import { z } from "zod";
import { publicProcedure, router } from "../..";

export const createUsageRouter = () => {
	return router({
		getStats: publicProcedure
			.input(z.object({ force: z.boolean() }).optional())
			.query(({ input }) => computeUsageStats(Date.now(), input?.force)),
		getClaudeProfile: publicProcedure.query(() => getClaudeProfile()),
		setClaudeProfileMode: publicProcedure
			// "auto" or a profile id; setClaudeProfileMode ignores unknown ids.
			.input(z.object({ mode: z.string().min(1) }))
			.mutation(({ input }) => {
				setClaudeProfileMode(input.mode);
				return getClaudeProfile();
			}),
	});
};
