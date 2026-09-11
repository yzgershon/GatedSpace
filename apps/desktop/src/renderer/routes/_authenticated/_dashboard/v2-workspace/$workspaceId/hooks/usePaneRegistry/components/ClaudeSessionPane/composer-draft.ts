/**
 * The composer draft: what has been typed but not sent, per pane.
 *
 * A module of its own, and not only for tidiness. `sessionStore.ts` reaches the
 * electron tRPC client, which has no global outside a renderer, so importing it
 * from a test errors at module load — the draft rules are exactly the kind of
 * thing that needs a test, so they live where one can reach them.
 */
import type { UserImagePayload } from "shared/claude-session/events";

/**
 * What's been typed but not sent, per pane.
 *
 * This lives OUTSIDE React for the same reason the timeline does: the pane
 * unmounts on a tab switch, opening another session, or navigating anywhere
 * else in the app, and component state goes with it. Losing a half-written
 * timeline was a bug worth fixing; losing a half-written PROMPT is worse,
 * because the user typed it and nothing else has a copy.
 *
 * Attachments ride along, since re-picking a screenshot is the same loss.
 */
export interface ComposerDraft {
	text: string;
	images: UserImagePayload[];
}

const EMPTY_DRAFT: ComposerDraft = { text: "", images: [] };
const drafts = new Map<string, ComposerDraft>();
const draftListeners = new Map<string, Set<() => void>>();

/**
 * Drafts also go to `localStorage`, not just this module's Map.
 *
 * The Map alone survives an unmount, which is what it was built for. It does
 * NOT survive the renderer being torn down and rebuilt, and it does not survive
 * any path that manages to load this module twice. A half-written prompt was
 * lost in the wild on 1.17.51 after opening a terminal pane, and reading the
 * code back could not prove which of those it was — so rather than fix one
 * suspected path, this makes the whole class impossible: the text is on disk
 * within a keystroke of being typed, and the Map becomes a cache in front of it.
 *
 * TEXT ONLY. Images are base64 payloads that routinely run to megabytes, and
 * `localStorage` is a ~5MB synchronous store shared with everything else in the
 * renderer — persisting them would trade a lost sentence for a quota crash.
 * Attachments still live in the Map and still survive an unmount.
 */
const DRAFT_STORAGE_PREFIX = "gatedspace:composer-draft:";

function readStoredDraftText(key: string): string {
	try {
		return localStorage.getItem(DRAFT_STORAGE_PREFIX + key) ?? "";
	} catch {
		// Private mode, quota, a disabled store: a draft is never worth throwing
		// inside a render.
		return "";
	}
}

function writeStoredDraftText(key: string, text: string): void {
	try {
		if (text) localStorage.setItem(DRAFT_STORAGE_PREFIX + key, text);
		else localStorage.removeItem(DRAFT_STORAGE_PREFIX + key);
	} catch {
		// Ignore: the in-memory draft is still correct.
	}
}

export function getSessionDraft(key: string): ComposerDraft {
	const live = drafts.get(key);
	if (live) return live;
	// Nothing in memory. Fall back to disk, which is the case that matters
	// after a reload or a module reinstantiation.
	const text = readStoredDraftText(key);
	if (!text) return EMPTY_DRAFT;
	const restored: ComposerDraft = { text, images: [] };
	drafts.set(key, restored);
	return restored;
}

export function setSessionDraft(key: string, draft: ComposerDraft): void {
	// Don't hold an entry for an empty box — it'd keep a key alive for every
	// pane that was ever focused and then cleared.
	if (!draft.text && draft.images.length === 0) drafts.delete(key);
	else drafts.set(key, draft);
	writeStoredDraftText(key, draft.text);
}

/**
 * Forget a pane's draft entirely — memory AND disk.
 *
 * Both, always. Clearing only the Map would leave the text on disk for
 * `getSessionDraft` to helpfully restore into the next pane that happened to
 * reuse the id; clearing only disk would leave the Map answering with it.
 */
export function deleteSessionDraft(key: string): void {
	drafts.delete(key);
	writeStoredDraftText(key, "");
}

/**
 * Watch a draft for changes made from OUTSIDE the composer.
 *
 * The composer owns its own state and mirrors it out here, so it does not need
 * this for its own edits — only for something else writing into its box, which
 * today means a browser-pane capture being attached to it.
 */
export function subscribeSessionDraft(
	key: string,
	listener: () => void,
): () => void {
	const listeners = draftListeners.get(key) ?? new Set();
	listeners.add(listener);
	draftListeners.set(key, listeners);
	return () => {
		listeners.delete(listener);
		if (listeners.size === 0) draftListeners.delete(key);
	};
}

/**
 * Attach an image to a session's composer from elsewhere in the app.
 *
 * Goes through the draft store rather than a live component, so it works
 * whether or not that pane is currently mounted: capture a page, switch to the
 * session tab, and the screenshot is already waiting. A pane that has never
 * been opened gets a draft it will pick up the first time it is.
 */
export function attachSessionDraftImage(
	key: string,
	image: UserImagePayload,
): void {
	const current = getSessionDraft(key);
	setSessionDraft(key, { ...current, images: [...current.images, image] });
	for (const listener of draftListeners.get(key) ?? []) listener();
}

/**
 * Append text to a session's composer from elsewhere in the app.
 *
 * The text sibling of `attachSessionDraftImage`, and appends rather than
 * replaces for the same reason dictation does: whatever is already in the box
 * was typed on purpose. Used by the browser pane's element picker.
 *
 * Separated by a blank line when there is something to separate from, so a
 * picked element does not run into the end of a half-written sentence.
 */
export function appendSessionDraftText(key: string, text: string): void {
	if (!text) return;
	const current = getSessionDraft(key);
	const separator = current.text.trim() ? "\n\n" : "";
	setSessionDraft(key, { ...current, text: current.text + separator + text });
	for (const listener of draftListeners.get(key) ?? []) listener();
}
