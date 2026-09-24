import { z } from "zod";

export const providerSchema = z.enum(["claude", "codex"]);
export type MobileProvider = z.infer<typeof providerSchema>;
export const imageSchema = z.object({
	name: z.string().max(256).default("image.jpg"),
	mediaType: z.enum(["image/png", "image/jpeg", "image/webp", "image/gif"]),
	data: z
		.string()
		.min(4)
		.max(5_000_000)
		.regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
	thumbnail: z
		.string()
		.max(200_000)
		.regex(/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/)
		.optional(),
});
export const promptSchema = z
	.object({
		requestId: z.string().uuid(),
		text: z.string().max(200_000).default(""),
		images: z.array(imageSchema).max(6).default([]),
	})
	.refine(
		(p) => p.text.trim() || p.images.length,
		"Write a message or attach an image.",
	);

export interface MobileMessage {
	id: string;
	kind: "user" | "assistant" | "activity" | "notice";
	text: string;
	title?: string;
	status?: string;
	images?: { name: string; source?: string; index?: number }[];
}

/** Same request ID joins the original operation, including after a lost response. */
export class RequestLedger {
	private entries = new Map<
		string,
		{ signature: string; value: Promise<unknown>; at: number }
	>();
	run<T>(id: string, signature: string, action: () => Promise<T>): Promise<T> {
		for (const [key, entry] of this.entries) {
			if (Date.now() - entry.at > 30 * 60_000) this.entries.delete(key);
		}
		const existing = this.entries.get(id);
		if (existing) {
			if (existing.signature !== signature)
				return Promise.reject(
					new Error("This request ID belongs to a different message."),
				);
			return existing.value as Promise<T>;
		}
		if (this.entries.size >= 500)
			return Promise.reject(
				new Error("Too many recent requests. Try again shortly."),
			);
		const value = Promise.resolve().then(action);
		this.entries.set(id, { signature, value, at: Date.now() });
		return value;
	}
}

export function messagePage(
	items: MobileMessage[],
	before?: string,
	pageSize = 300,
) {
	const end = before
		? items.findIndex((item) => item.id === before)
		: items.length;
	if (end < 0)
		throw new Error(
			"This history position changed. Reopen the conversation to refresh it.",
		);
	const start = Math.max(0, end - pageSize);
	return { messages: items.slice(start, end), hasEarlier: start > 0 };
}
