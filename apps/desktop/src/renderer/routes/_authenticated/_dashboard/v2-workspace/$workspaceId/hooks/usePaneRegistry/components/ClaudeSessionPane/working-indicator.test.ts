import { describe, expect, test } from "bun:test";
import {
	FRAME_MS,
	formatElapsed,
	formatThought,
	PHRASE_MS,
	phraseAt,
	SPINNER_FRAMES,
	spinnerFrame,
	TYPE_MS,
	typedPhrase,
	WORKING_PHRASES,
} from "./working-indicator";

describe("spinnerFrame", () => {
	test("advances one frame per interval", () => {
		expect(spinnerFrame(0)).toBe(SPINNER_FRAMES[0]);
		expect(spinnerFrame(FRAME_MS)).toBe(SPINNER_FRAMES[1]);
		expect(spinnerFrame(FRAME_MS * 2)).toBe(SPINNER_FRAMES[2]);
	});

	test("holds a frame for its whole interval instead of flickering", () => {
		expect(spinnerFrame(FRAME_MS - 1)).toBe(SPINNER_FRAMES[0]);
	});

	test("wraps at the end of the cycle", () => {
		expect(spinnerFrame(FRAME_MS * SPINNER_FRAMES.length)).toBe(
			SPINNER_FRAMES[0],
		);
	});
});

describe("phraseAt", () => {
	test("holds one phrase for its whole window", () => {
		expect(phraseAt(0, 0)).toBe(phraseAt(PHRASE_MS - 1, 0));
	});

	test("moves on at the window boundary", () => {
		expect(phraseAt(PHRASE_MS, 0)).not.toBe(phraseAt(0, 0));
	});

	test("the offset shifts which phrase, so two panes don't chant together", () => {
		expect(phraseAt(0, 0)).not.toBe(phraseAt(0, 1));
	});

	test("wraps past the end of the list rather than running out", () => {
		expect(phraseAt(PHRASE_MS * WORKING_PHRASES.length, 0)).toBe(
			phraseAt(0, 0),
		);
	});
});

describe("typedPhrase", () => {
	test("starts empty", () => {
		expect(typedPhrase(0, 0)).toBe("");
	});

	test("reveals a character per tick", () => {
		const full = phraseAt(0, 0);
		expect(typedPhrase(TYPE_MS, 0)).toBe(full.slice(0, 1));
		expect(typedPhrase(TYPE_MS * 3, 0)).toBe(full.slice(0, 3));
	});

	test("stops at the end of the word instead of overrunning it", () => {
		const full = phraseAt(0, 0);
		expect(typedPhrase(TYPE_MS * (full.length + 50), 0)).toBe(full);
	});

	test("restarts the reveal for each new phrase", () => {
		// One tick into the SECOND phrase: one character, not a full word.
		expect(typedPhrase(PHRASE_MS + TYPE_MS, 0).length).toBe(1);
	});
});

describe("formatElapsed", () => {
	test("seconds under a minute", () => {
		expect(formatElapsed(0)).toBe("0s");
		expect(formatElapsed(3_400)).toBe("3s");
	});

	test("rounds down, so it never claims time that hasn't passed", () => {
		expect(formatElapsed(1_999)).toBe("1s");
		expect(formatElapsed(59_999)).toBe("59s");
	});

	test("minutes and seconds", () => {
		expect(formatElapsed(60_000)).toBe("1m");
		expect(formatElapsed(90_000)).toBe("1m 30s");
	});

	test("drops the seconds when they're zero", () => {
		expect(formatElapsed(120_000)).toBe("2m");
	});

	test("hours, for the sessions that earn them", () => {
		expect(formatElapsed(3_600_000)).toBe("1h");
		expect(formatElapsed(3_600_000 + 300_000)).toBe("1h 5m");
	});
});

describe("formatThought", () => {
	test("under a second reads as a moment, not a broken timer", () => {
		expect(formatThought(0)).toBe("a moment");
		expect(formatThought(999)).toBe("a moment");
	});

	test("a second and over gets the real number", () => {
		expect(formatThought(1_000)).toBe("1s");
		expect(formatThought(12_400)).toBe("12s");
	});

	test("long thoughts still read in minutes", () => {
		expect(formatThought(90_000)).toBe("1m 30s");
	});
});
