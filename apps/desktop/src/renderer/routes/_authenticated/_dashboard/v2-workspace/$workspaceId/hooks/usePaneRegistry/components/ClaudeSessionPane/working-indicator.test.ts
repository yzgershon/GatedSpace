import { describe, expect, it, test } from "bun:test";
import {
	CARET_BLINK_MS,
	caretVisible,
	easeOutCubic,
	FRAME_MS,
	formatElapsed,
	formatThought,
	formatTokens,
	PHRASE_MS,
	phraseAt,
	revealedChars,
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

describe("easeOutCubic", () => {
	test("pins both ends", () => {
		expect(easeOutCubic(0)).toBe(0);
		expect(easeOutCubic(1)).toBe(1);
	});

	test("clamps rather than overshooting", () => {
		// Progress is computed from raw elapsed time, so out-of-range input is
		// the normal case, not a bug to guard against elsewhere.
		expect(easeOutCubic(-5)).toBe(0);
		expect(easeOutCubic(9)).toBe(1);
	});

	test("decelerates, so a character lands rather than slides", () => {
		expect(easeOutCubic(0.5)).toBeGreaterThan(0.5);
	});
});

describe("revealedChars", () => {
	test("returns the whole phrase from the very first frame", () => {
		// Every character, always — a growing prefix would shove the elapsed
		// counter sideways once per character.
		const chars = revealedChars(0, 0);
		expect(chars.map((c) => c.char).join("")).toBe(phraseAt(0, 0));
	});

	test("has nothing arrived at the instant a phrase starts", () => {
		expect(revealedChars(0, 0).every((c) => c.progress === 0)).toBe(true);
	});

	test("arrives left to right", () => {
		const chars = revealedChars(TYPE_MS * 3, 0);
		expect(chars[0]?.progress).toBeGreaterThan(chars[2]?.progress ?? 1);
		expect(chars.at(-1)?.progress).toBe(0);
	});

	test("overlaps several characters mid-fade", () => {
		// The overlap is what separates a type-in from letters blinking on one
		// at a time, and it only happens because CHAR_FADE_MS > TYPE_MS.
		const partial = revealedChars(TYPE_MS * 4, 0).filter(
			(c) => c.progress > 0 && c.progress < 1,
		);
		expect(partial.length).toBeGreaterThan(1);
	});

	test("settles every character well before the phrase changes", () => {
		const chars = revealedChars(PHRASE_MS - 1, 0);
		expect(chars.every((c) => c.progress === 1)).toBe(true);
	});
});

describe("caretVisible", () => {
	test("stays solid while characters are still arriving", () => {
		// There is already motion; a blink on top of it competes.
		expect(caretVisible(TYPE_MS * 2, 0)).toBe(true);
	});

	test("blinks once the word is finished", () => {
		const done = phraseAt(0, 0).length * TYPE_MS;
		const on = caretVisible(done + 10, 0);
		const off = caretVisible(done + 10 + CARET_BLINK_MS / 2, 0);
		expect(on).not.toBe(off);
	});
});

describe("formatTokens", () => {
	it("is exact below a thousand", () => {
		expect(formatTokens(0)).toBe("0");
		expect(formatTokens(847)).toBe("847");
		expect(formatTokens(999)).toBe("999");
	});

	it("switches to thousands with one decimal", () => {
		expect(formatTokens(1000)).toBe("1.0k");
		expect(formatTokens(1234)).toBe("1.2k");
		expect(formatTokens(45_600)).toBe("45.6k");
	});

	it("keeps the trailing zero so the line does not change width", () => {
		// "2k" and "2.1k" alternating would make the whole row twitch as the
		// count climbs, which is worse than the extra character.
		expect(formatTokens(2000)).toBe("2.0k");
	});

	it("rounds rather than truncates", () => {
		expect(formatTokens(1950)).toBe("2.0k");
	});

	it("switches again at a million", () => {
		expect(formatTokens(1_500_000)).toBe("1.5M");
	});

	it("never shows a negative", () => {
		// Guards against a subtraction going the wrong way upstream.
		expect(formatTokens(-5)).toBe("0");
	});
});
