export interface PromptEntry {
	id: string;
	text: string;
	reply?: string;
	imageCount?: number;
}

/** A short text preview; keep provider markup and image payloads out of the rail. */
export function promptPreview(text: string) {
	return text
		.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/(^|\s)[#*>`]+\s?/g, "$1")
		.replace(/\*\*|__/g, "")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 360);
}

export function collectPrompts(
	items: readonly {
		id: string;
		kind: string;
		text?: string;
		parentToolUseId?: string | null;
		images?: unknown[];
		imagePaths?: unknown[];
		attachments?: unknown[];
	}[],
): PromptEntry[] {
	const prompts: PromptEntry[] = [];
	for (const item of items) {
		if (item.parentToolUseId) continue;
		if (item.kind === "user") {
			prompts.push({
				id: item.id,
				text: promptPreview(item.text ?? "") || "Image attachment",
				imageCount:
					(item.images?.length ?? 0) +
					(item.imagePaths?.length ?? 0) +
					(item.attachments?.length ?? 0),
			});
		} else if (item.kind === "assistant" || item.kind === "text") {
			const prompt = prompts.at(-1);
			if (prompt && !prompt.reply && item.text)
				prompt.reply = promptPreview(item.text);
		}
	}
	return prompts;
}
