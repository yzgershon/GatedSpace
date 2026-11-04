import { homedir } from "node:os";
import { join } from "node:path";
import { ClaudeCompactionSettings } from "main/lib/claude-compaction/settings";
import { listClaudeProfiles } from "main/lib/claude-profile";
import { claudeCompactionPreference } from "shared/claude-compaction";
import { publicProcedure, router } from "..";

const settings = new ClaudeCompactionSettings(() => [
	{ label: "Default Claude account", configDir: join(homedir(), ".claude") },
	...listClaudeProfiles(),
]);
export const createClaudeCompactionRouter = () =>
	router({
		get: publicProcedure.query(() => settings.get()),
		set: publicProcedure
			.input(claudeCompactionPreference)
			.mutation(({ input }) => settings.set(input)),
	});
