import {
	addClaudeProfile,
	getClaudeProfile,
	removeClaudeProfile,
	setClaudeProfileMode,
} from "main/lib/claude-profile";
import {
	getStatusLineState,
	installStatusLine,
	uninstallStatusLine,
} from "main/lib/claude-status-line";
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
		addClaudeProfile: publicProcedure
			.input(z.object({ label: z.string().trim().min(1).max(40) }))
			.mutation(({ input }) => {
				const profile = addClaudeProfile(input.label);
				// New accounts become the active one: the user just asked for it,
				// and the next agent they launch is what performs the CLI login.
				setClaudeProfileMode(profile.id);
				return { profile, state: getClaudeProfile() };
			}),
		removeClaudeProfile: publicProcedure
			.input(z.object({ id: z.string().min(1) }))
			.mutation(({ input }) => {
				removeClaudeProfile(input.id);
				return getClaudeProfile();
			}),

		// Claude Code's status line — the in-terminal metrics row, and the only
		// local source of real subscription limits (see claude-status-line).
		getStatusLine: publicProcedure.query(() => getStatusLineState()),
		installStatusLine: publicProcedure
			.input(z.object({ replaceCustom: z.boolean() }).optional())
			.mutation(({ input }) =>
				installStatusLine({ replaceCustom: input?.replaceCustom ?? false }),
			),
		uninstallStatusLine: publicProcedure.mutation(() => uninstallStatusLine()),
	});
};
