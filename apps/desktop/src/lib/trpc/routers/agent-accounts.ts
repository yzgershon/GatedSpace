import { existsSync } from "node:fs";
import { join } from "node:path";
import { shell } from "electron";
import { codexProfiles } from "main/lib/agent-accounts/codex-profiles";
import { AgentAccounts } from "main/lib/agent-accounts/service";
import {
	getClaudeProfile,
	setClaudeProfileMode,
} from "main/lib/claude-profile";
import { codexSessionManager } from "main/lib/codex-session/session-manager";
import { z } from "zod";
import { publicProcedure, router } from "..";

const accounts = new AgentAccounts((url) => shell.openExternal(url));
const provider = z.enum(["claude", "codex"]);
export const createAgentAccountsRouter = () =>
	router({
		list: publicProcedure.input(z.object({ provider })).query(({ input }) => {
			if (input.provider === "claude") {
				const state = getClaudeProfile();
				return {
					activeId: state.activeProfileId,
					accounts: state.profiles.map((p) => ({
						id: p.id,
						label: p.label,
						ready: p.ready,
						detail: p.exhausted
							? "Usage limit reached"
							: p.email || "Claude Code",
					})),
					sessions: [] as Array<{
						key: string;
						title: string;
						accountId?: string;
					}>,
				};
			}
			const state = codexProfiles.list();
			return {
				activeId: state.activeId,
				accounts: state.profiles.map((p) => ({
					id: p.id,
					label: p.label,
					ready: existsSync(join(p.home, "auth.json")),
					detail: "Codex",
				})),
				sessions: codexSessionManager
					.listSessions()
					.map((s) => ({ key: s.key, title: s.title, accountId: s.accountId })),
			};
		}),
		select: publicProcedure
			.input(z.object({ provider, id: z.string(), key: z.string().optional() }))
			.mutation(async ({ input }) => {
				if (input.provider === "claude") {
					if (input.key)
						throw new Error(
							"Use /swap in this Claude session to move its conversation.",
						);
					if (
						!getClaudeProfile().profiles.find((p) => p.id === input.id)?.ready
					)
						throw new Error("Sign in to this account first.");
					setClaudeProfileMode(input.id);
				} else if (input.key)
					await codexSessionManager.switchAccount(input.key, input.id);
				else {
					const profile = codexProfiles.get(input.id);
					if (!existsSync(join(profile.home, "auth.json")))
						throw new Error("Sign in to this account first.");
					codexProfiles.select(input.id);
				}
				return { ok: true };
			}),
		login: publicProcedure
			.input(
				z.object({
					provider,
					nickname: z.string().trim().min(1).max(40),
					accountId: z.string().optional(),
				}),
			)
			.mutation(({ input }) =>
				accounts.begin(input.provider, input.nickname, input.accountId),
			),
		loginStatus: publicProcedure
			.input(z.object({ id: z.string() }))
			.query(({ input }) => accounts.status(input.id)),
		cancelLogin: publicProcedure
			.input(z.object({ id: z.string() }))
			.mutation(({ input }) => accounts.cancel(input.id)),
	});
