import { describe, expect, it } from "bun:test";
import {
	activeMention,
	EFFORT_LABELS,
	EFFORT_LEVELS,
	nextMode,
	SESSION_MODES,
	type SessionMode,
} from "./SessionComposer";

describe("activeMention", () => {
	it("finds the token being typed at the caret", () => {
		const text = "look at @src/main";
		expect(activeMention(text, text.length)).toEqual({
			query: "src/main",
			start: 8,
		});
	});

	it("treats a bare @ as an empty query, so the picker opens immediately", () => {
		expect(activeMention("@", 1)).toEqual({ query: "", start: 0 });
	});

	it("ignores an @ inside a word — an email is not a mention", () => {
		expect(activeMention("mail yish@example.com", 21)).toBeNull();
	});

	it("ends the mention at whitespace", () => {
		expect(activeMention("@src/main and then", 18)).toBeNull();
	});

	it("reads the token the caret is in, not the last one in the string", () => {
		// Caret sits right after the first mention; the later @ must not win.
		const text = "@alpha @beta";
		expect(activeMention(text, 6)).toEqual({ query: "alpha", start: 0 });
	});

	it("has no mention when there's no @ before the caret", () => {
		expect(activeMention("plain prompt", 12)).toBeNull();
	});
});

describe("nextMode", () => {
	it("steps forward through the list", () => {
		expect(nextMode("manual")).toBe("acceptEdits");
		expect(nextMode("acceptEdits")).toBe("plan");
		expect(nextMode("plan")).toBe("bypassPermissions");
	});

	it("wraps at the end, so Shift+Tab never dead-ends", () => {
		expect(nextMode("bypassPermissions")).toBe("manual");
	});

	it("visits every mode before repeating", () => {
		const seen = new Set<string>();
		let mode: SessionMode = SESSION_MODES[0].id;
		for (let i = 0; i < SESSION_MODES.length; i++) {
			seen.add(mode);
			mode = nextMode(mode);
		}
		expect(seen.size).toBe(SESSION_MODES.length);
		expect(mode).toBe(SESSION_MODES[0].id);
	});
});

describe("effort levels", () => {
	it("keeps the ids the CLI actually accepts", () => {
		// These are sent verbatim as `/effort <id>`. Renaming one to read better
		// would make the slider silently stop working.
		expect([...EFFORT_LEVELS]).toEqual([
			"low",
			"medium",
			"high",
			"xhigh",
			"max",
			"ultracode",
		]);
	});

	it("labels every level for display, never showing the raw id", () => {
		for (const level of EFFORT_LEVELS) {
			const label = EFFORT_LABELS[level];
			expect(label.length).toBeGreaterThan(0);
			// Never the bare id: that is what rendered "xhigh" as "Xhigh".
			expect(label).not.toBe(level);
			expect(label[0]).toBe(label[0]?.toUpperCase());
		}
	});

	it("spells out the one id that is not a word", () => {
		expect(EFFORT_LABELS.xhigh).toBe("Extra high");
	});
});
