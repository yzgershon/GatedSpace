import { z } from "zod";

import {
	chatImageSchema,
	chatImageUrlSchema,
	MAX_CHAT_IMAGES,
} from "./image-attachments";

export const queuedPromptSchema = z.discriminatedUnion("provider", [
	z.object({
		provider: z.literal("codex"),
		text: z.string().max(100_000),
		images: z.array(chatImageUrlSchema).max(MAX_CHAT_IMAGES).optional(),
		model: z.string(),
		effort: z.string(),
		permission: z.enum(["default", "read-only", "full-access"]),
		plan: z.boolean().optional(),
		fast: z.boolean().optional(),
	}),
	z.object({
		provider: z.literal("claude"),
		text: z.string().max(100_000),
		images: z.array(chatImageSchema).max(MAX_CHAT_IMAGES).optional(),
	}),
]);
// Older outboxes allowed larger Codex images and arbitrary image MIME strings.
// Keep them recoverable for editing/removal; new sends still use strict limits.
export const storedQueuedPromptSchema = z.union([
	queuedPromptSchema,
	z.discriminatedUnion("provider", [
		queuedPromptSchema.options[0].extend({
			images: z.array(z.string().max(12_000_000)).max(10).optional(),
		}),
		queuedPromptSchema.options[1].extend({
			images: z
				.array(
					chatImageSchema.extend({
						mediaType: z.string(),
						data: z.string().max(5_000_000),
					}),
				)
				.max(10)
				.optional(),
		}),
	]),
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
