/**
 * Draft persistence, against the extracted module.
 *
 * `sessionStore.draft.test.ts` cannot cover these: it imports `sessionStore`,
 * which reaches the electron tRPC client and errors at module load outside a
 * renderer. That file is one of the suite's pre-existing load failures, so a
 * test written into it would never actually run.
 */
import { beforeEach, describe, expect, test } from "bun:test";

/**
 * A `localStorage` stub, installed BEFORE the module under test is imported.
 *
 * Bun's test runner has no DOM. The module reads storage lazily inside
 * try/catch, so without this every persistence path would silently take the
 * catch and the tests would pass while proving nothing.
 */
const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
	getItem: (key: string) => store.get(key) ?? null,
	setItem: (key: string, value: string) => {
		store.set(key, value);
	},
	removeItem: (key: string) => {
		store.delete(key);
	},
	clear: () => {
		store.clear();
	},
};

const { deleteSessionDraft, getSessionDraft, setSessionDraft } = await import(
	"./composer-draft"
);

const KEY = "pane-persist";
const STORAGE_KEY = `gatedspace:composer-draft:${KEY}`;

describe("draft persistence", () => {
	beforeEach(() => {
		store.clear();
		// Drop the in-memory entry too, so each test starts from a clean map.
		deleteSessionDraft(KEY);
		setSessionDraft(KEY, { text: "", images: [] });
		store.clear();
	});

	test("writes the text through to storage", () => {
		setSessionDraft(KEY, { text: "half a sentence", images: [] });
		expect(store.get(STORAGE_KEY)).toBe("half a sentence");
	});

	/**
	 * The case the in-memory Map cannot cover: its state is gone — a reload, a
	 * torn-down renderer, a second instantiation — and disk is all that is left.
	 */
	test("recovers text when the in-memory map has lost it", () => {
		store.set(STORAGE_KEY, "half a sentence");
		expect(getSessionDraft(KEY).text).toBe("half a sentence");
	});

	/**
	 * Images are megabytes of base64 and `localStorage` is a ~5MB synchronous
	 * store shared with the rest of the renderer. Persisting them would trade a
	 * lost sentence for a quota crash.
	 */
	test("never persists attachments", () => {
		setSessionDraft(KEY, {
			text: "look at this",
			images: [{ name: "a.png", mediaType: "image/png", data: "x".repeat(64) }],
		});
		expect(store.get(STORAGE_KEY)).toBe("look at this");
	});

	test("an attachment still survives in memory", () => {
		setSessionDraft(KEY, {
			text: "look at this",
			images: [{ name: "a.png", mediaType: "image/png", data: "abc" }],
		});
		expect(getSessionDraft(KEY).images).toHaveLength(1);
	});

	test("clearing removes the stored copy", () => {
		setSessionDraft(KEY, { text: "gone soon", images: [] });
		setSessionDraft(KEY, { text: "", images: [] });
		expect(store.get(STORAGE_KEY)).toBeUndefined();
	});

	test("an untouched pane reads as empty rather than undefined", () => {
		expect(getSessionDraft("pane-never-touched")).toEqual({
			text: "",
			images: [],
		});
	});
});
