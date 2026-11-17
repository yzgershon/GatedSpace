import type { CodexPermission } from "shared/codex-session/types";
import {
	chatImageUrlSchema,
	IMAGE_LIMIT_MESSAGE,
	MAX_CHAT_IMAGES,
} from "shared/image-attachments";
import { CodexPreferenceStore } from "./preferences";

export interface CodexDraft {
	model?: string;
	effort?: string;
	permission?: CodexPermission;
	plan?: boolean;
	fast?: boolean;
	text: string;
	images: Array<{ name: string; url: string }>;
}
const drafts = new Map<string, CodexDraft>();
const listeners = new Map<string, Set<() => void>>();
const preferences = new CodexPreferenceStore(() => localStorage);
const sessions = new Map<string, string>();
export function getCodexDraft(key: string): CodexDraft {
	const existing = drafts.get(key);
	if (existing) return existing;
	let text = "";
	try {
		text = localStorage.getItem(`codex-draft:${key}`) ?? "";
	} catch {}
	const draft = { ...preferences.get(key), text, images: [] };
	drafts.set(key, draft);
	return draft;
}
export function updateCodexDraft(
	key: string,
	patch: Partial<CodexDraft>,
	options?: { transient?: boolean },
) {
	const draft = { ...getCodexDraft(key), ...patch };
	if (!options?.transient) preferences.update(key, patch);
	drafts.set(key, draft);
	if (patch.text !== undefined) {
		try {
			localStorage.setItem(`codex-draft:${key}`, draft.text);
		} catch {
			/* Keep the in-memory draft even when browser storage is full. */
		}
	}
	for (const fn of listeners.get(key) ?? []) fn();
}
export function bindCodexDraftSession(key: string, threadId: string) {
	if (sessions.get(key) === threadId) return;
	const saved = preferences.bind(key, threadId);
	sessions.set(key, threadId);
	updateCodexDraft(key, saved, { transient: true });
}
export function subscribeCodexDraft(key: string, fn: () => void) {
	let set = listeners.get(key);
	if (!set) {
		set = new Set();
		listeners.set(key, set);
	}
	set.add(fn);
	return () => {
		set.delete(fn);
		if (!set.size) listeners.delete(key);
	};
}
export function appendCodexDraftText(key: string, text: string) {
	const draft = getCodexDraft(key);
	updateCodexDraft(key, {
		text: [draft.text, text].filter(Boolean).join("\n\n"),
	});
}
export function attachCodexDraftImage(
	key: string,
	image: { name: string; url: string },
) {
	if (
		getCodexDraft(key).images.length >= MAX_CHAT_IMAGES ||
		!chatImageUrlSchema.safeParse(image.url).success
	)
		throw new Error(IMAGE_LIMIT_MESSAGE);
	updateCodexDraft(key, {
		images: [...getCodexDraft(key).images, image],
	});
}
