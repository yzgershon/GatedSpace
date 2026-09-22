import { expect, test } from "bun:test";
import {
	appendCodexDraftText,
	attachCodexDraftImage,
	getCodexDraft,
	subscribeCodexDraft,
	updateCodexDraft,
} from "./draft";

test("browser context and screenshots survive a composer remount without crossing panes", () => {
	const key = crypto.randomUUID();
	updateCodexDraft(key, { text: "Fix this" });
	let notifications = 0;
	const unsubscribe = subscribeCodexDraft(key, () => notifications++);
	appendCodexDraftText(key, "Selected button");
	attachCodexDraftImage(key, {
		name: "page.png",
		url: "data:image/png;base64,test",
	});
	const saved = getCodexDraft(key);
	unsubscribe();
	expect(getCodexDraft(key)).toBe(saved);
	expect(saved.text).toBe("Fix this\n\nSelected button");
	expect(saved.images).toHaveLength(1);
	expect(notifications).toBe(2);
	expect(getCodexDraft(crypto.randomUUID()).text).toBe("");
});
