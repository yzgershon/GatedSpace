import { z } from "zod";

const image = z.object({
	name: z.string(),
	mediaType: z.string(),
	data: z.string().max(5_000_000),
	width: z.number().optional(),
	height: z.number().optional(),
});
export const queuedPromptSchema = z.discriminatedUnion("provider", [
	z.object({
		provider: z.literal("codex"),
		text: z.string().max(100_000),
		images: z.array(z.string().max(12_000_000)).max(10).optional(),
		model: z.string(),
		effort: z.string(),
		permission: z.enum(["default", "read-only", "full-access"]),
		plan: z.boolean().optional(),
		fast: z.boolean().optional(),
	}),
	z.object({
		provider: z.literal("claude"),
		text: z.string().max(100_000),
		images: z.array(image).max(10).optional(),
	}),
]);
export type QueuedPrompt = z.infer<typeof queuedPromptSchema>;
export interface QueuedMessage {
	id: string;
	prompt: QueuedPrompt;
	createdAt: number;
}
export interface SessionQueueState {
	entries: QueuedMessage[];
	paused: boolean;
	pauseVersion?: number;
	error?: string;
	sendingId?: string;
	sessionId?: string;
}
