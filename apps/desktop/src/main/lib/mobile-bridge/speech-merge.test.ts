import { describe, expect, it } from "bun:test";
import { SPEECH_MERGE_JS } from "./speech-merge";

/**
 * The shipped source is compiled and run here, not a TypeScript copy of it, so
 * these assertions are about the code that actually reaches the phone.
 */
const mergeSpeech = new Function(
	`${SPEECH_MERGE_JS}; return mergeSpeech;`,
)() as (prev: string, cur: string) => string;

describe("merging speech", () => {
	it("takes whichever side is the only one with anything", () => {
		expect(mergeSpeech("", "hello")).toBe("hello");
		expect(mergeSpeech("hello", "")).toBe("hello");
		expect(mergeSpeech("", "")).toBe("");
	});

	it("lets a superset supersede rather than repeat", () => {
		// THE bug. Android hands back everything it has heard on every restart,
		// so appending "hello this" to a banked "hello" produced "hellohello
		// this" — and the next round compounded it.
		expect(mergeSpeech("hello", "hello this")).toBe("hello this");
		expect(mergeSpeech("hello this", "hello this is a test")).toBe(
			"hello this is a test",
		);
	});

	it("reproduces the exact reported failure as a clean result", () => {
		// Replaying the observed sequence of snapshots must end at the sentence,
		// not at a concatenation of every prefix of it.
		const snapshots = [
			"hello",
			"hello this",
			"hello this is",
			"hello this is a",
			"hello this is a test",
			"hello this is a test to show Claude",
		];
		let merged = "";
		for (const snapshot of snapshots) merged = mergeSpeech(merged, snapshot);
		expect(merged).toBe("hello this is a test to show Claude");
	});

	it("appends when the recogniser genuinely started fresh", () => {
		// The other behaviour, which the fix must not break: a clean restart
		// delivers only the new words.
		expect(mergeSpeech("hello", "this is a test")).toBe("hello this is a test");
	});

	it("joins at the seam when the two overlap partway", () => {
		expect(mergeSpeech("hello this is", "this is a test")).toBe(
			"hello this is a test",
		);
	});

	it("prefers the longest overlap, so the join is the specific one", () => {
		// "a" overlaps too, and joining there would drop words.
		expect(mergeSpeech("what a day it is", "it is a good day")).toBe(
			"what a day it is a good day",
		);
	});

	it("keeps what it has when a late event arrives with less", () => {
		// A discarded recognizer's last event can land after newer text is
		// banked; it must not roll the box backwards.
		expect(mergeSpeech("hello this is a test", "hello this")).toBe(
			"hello this is a test",
		);
	});

	it("ignores case when matching, but keeps what was said", () => {
		// Recognisers recapitalise as they gain context.
		expect(mergeSpeech("hello", "Hello this")).toBe("Hello this");
	});

	it("adds nothing when the same thing arrives twice", () => {
		expect(mergeSpeech("hello this", "hello this")).toBe("hello this");
	});

	it("does not fuse two separate words into one", () => {
		// The failure had no spaces at the joins. A plain append must keep them.
		expect(mergeSpeech("commit", "the changes")).toBe("commit the changes");
	});

	it("survives punctuation and repeated words", () => {
		expect(mergeSpeech("go, go", "go, go again")).toBe("go, go again");
	});

	it("trims the whitespace it is handed", () => {
		expect(mergeSpeech("  hello  ", "  hello this  ")).toBe("hello this");
	});
});
