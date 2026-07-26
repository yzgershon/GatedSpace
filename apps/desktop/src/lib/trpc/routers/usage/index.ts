import {
	addClaudeProfile,
	getClaudeProfile,
	removeClaudeProfile,
	setClaudeProfileMode,
} from "main/lib/claude-profile";
import {
	readProfileLimits,
	refreshAllProfileUsage,
	refreshProfileUsage,
} from "main/lib/claude-session/usage-refresh";
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

		/**
		 * The active profile's stored limits, read straight off disk — no process,
		 * no request. Cheap enough to ask for after every turn, which is what keeps
		 * the composer's warning honest.
		 */
		activeLimits: publicProcedure.query(() => {
			const state = getClaudeProfile();
			const active = state.profiles.find(
				(profile) => profile.id === state.activeProfileId,
			);
			if (!active) return null;
			return { label: active.label, ...readProfileLimits(active.configDir) };
		}),

		/**
		 * Refresh usage and hand back what the CLI said.
		 *
		 * The default (no `configDir`, no `all`) is the ACTIVE profile, and it
		 * RETURNS that profile's report. It used to refresh every profile and
		 * return null unconditionally, which meant the composer's `/usage` panel —
		 * whose only source is this return value — could never show anything at
		 * all. It read as "the session won't answer"; the session was never asked.
		 *
		 * `all: true` is for the usage dialog, which shows every account at once.
		 */
		refreshLimits: publicProcedure
			.input(
				z
					.object({
						configDir: z.string().min(1).optional(),
						force: z.boolean().optional(),
						all: z.boolean().optional(),
					})
					.optional(),
			)
			.mutation(async ({ input }) => {
				if (input?.configDir) {
					return refreshProfileUsage(input.configDir, { force: input.force });
				}
				if (input?.all) {
					await refreshAllProfileUsage(input.force);
					return null;
				}
				const state = getClaudeProfile();
				const active = state.profiles.find(
					(profile) => profile.id === state.activeProfileId,
				);
				if (!active) return null;
				return refreshProfileUsage(active.configDir, { force: input?.force });
			}),
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
