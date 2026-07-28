/**
 * The composer draft outlives the component, and these are the rules that make
 * that safe. The bug being pinned down: typing a prompt, then switching tabs or
 * opening another session, lost the text — the pane unmounts and component
 * state goes with it.
 */
import { describe, expect, test } from "bun:test";
import {
	appendSessionDraftText,
	getSessionDraft,
	setSessionDraft,
} from "./sessionStore";

const image = (name: string) => ({
	name,
	mediaType: "image/png",
	data: "abc",
});

describe("composer draft", () => {
	test("an untouched pane has an empty draft rather than undefined", () => {
		expect(getSessionDraft("pane-unknown")).toEqual({ text: "", images: [] });
	});

	test("survives being read back — the whole point", () => {
		setSessionDraft("pane-a", { text: "half a thought", images: [] });
		expect(getSessionDraft("pane-a").text).toBe("half a thought");
	});

	test("attachments survive too, since re-picking a screenshot is the same loss", () => {
		setSessionDraft("pane-b", { text: "", images: [image("shot.png")] });
		expect(getSessionDraft("pane-b").images).toHaveLength(1);
	});

	test("drafts are per pane and don't bleed across", () => {
		setSessionDraft("pane-c", { text: "mine", images: [] });
		setSessionDraft("pane-d", { text: "theirs", images: [] });
		expect(getSessionDraft("pane-c").text).toBe("mine");
		expect(getSessionDraft("pane-d").text).toBe("theirs");
	});

	test("clearing the box forgets the pane instead of holding an empty entry", () => {
		setSessionDraft("pane-e", { text: "typed", images: [] });
		setSessionDraft("pane-e", { text: "", images: [] });
		expect(getSessionDraft("pane-e")).toEqual({ text: "", images: [] });
	});

	test("an image with no text still counts as a draft worth keeping", () => {
		setSessionDraft("pane-f", { text: "", images: [image("only.png")] });
		expect(getSessionDraft("pane-f").images).toHaveLength(1);
	});

	test("sending clears it — the send path empties both fields", () => {
		setSessionDraft("pane-g", { text: "sent", images: [image("a.png")] });
		setSessionDraft("pane-g", { text: "", images: [] });
		expect(getSessionDraft("pane-g")).toEqual({ text: "", images: [] });
	});
});

describe("appendSessionDraftText", () => {
	test("appends rather than replacing what was typed", () => {
		// Whatever is already in the box was typed on purpose. The element
		// picker adds to it, same as dictation does.
		setSessionDraft("pane-append", { text: "why is this", images: [] });
		appendSessionDraftText("pane-append", "Selector: `#app > button`");
		expect(getSessionDraft("pane-append").text).toBe(
			"why is this\n\nSelector: `#app > button`",
		);
	});

	test("adds no leading blank line to an empty box", () => {
		appendSessionDraftText("pane-empty", "Selector: `#app`");
		expect(getSessionDraft("pane-empty").text).toBe("Selector: `#app`");
	});

	test("treats a whitespace-only draft as empty", () => {
		setSessionDraft("pane-ws", { text: "   ", images: [] });
		appendSessionDraftText("pane-ws", "picked");
		expect(getSessionDraft("pane-ws").text.startsWith("\n")).toBe(false);
	});

	test("keeps attached images", () => {
		setSessionDraft("pane-img", { text: "", images: [image("shot.png")] });
		appendSessionDraftText("pane-img", "picked");
		expect(getSessionDraft("pane-img").images).toHaveLength(1);
	});

	test("ignores an empty append instead of dirtying the draft", () => {
		appendSessionDraftText("pane-noop", "");
		expect(getSessionDraft("pane-noop")).toEqual({ text: "", images: [] });
	});
});
