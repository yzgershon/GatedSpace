import { z } from "zod";

export const claudeCompactionPreference = z.discriminatedUnion("mode", [
	z.object({ mode: z.literal("default") }),
	z.object({ mode: z.literal("off") }),
	z.object({
		mode: z.literal("custom"),
		windowTokens: z.number().int().min(100_000).max(1_000_000),
	}),
]);
export type ClaudeCompactionPreference = z.infer<
	typeof claudeCompactionPreference
>;
export interface ClaudeCompactionState {
	preference: ClaudeCompactionPreference | null;
	savedPreference: ClaudeCompactionPreference | null;
	accounts: { label: string; preference: ClaudeCompactionPreference | null }[];
}
