import { describe, expect, test } from "bun:test";
import { getAutocorrection } from "./autocorrect";

const correct = (text: string, suggestions?: (word: string) => string[]) =>
	getAutocorrection(text, text.length, suggestions)?.replacement ?? null;

describe("composer autocorrect", () => {
	test("corrects common English typos and contractions locally", () => {
		expect(correct("This happened becuase")).toBe("because");
		expect(correct("I dont")).toBe("don't");
		expect(correct("the cuttoff")).toBe("cutoff");
	});
	test("accepts one close dictionary match, not an ambiguous guess", () => {
		expect(correct("the bordre", () => ["border", "bored"])).toBe("border");
		expect(correct("the copu", () => ["copy", "coup"])).toBeNull();
		expect(correct("the xqzv", () => ["executive"])).toBeNull();
	});
	test("leaves names, identifiers, valid words and technical input alone", () => {
		for (const text of [
			"Teh",
			"imFeeling",
			"ill",
			"cant",
			"wont",
			"@teh",
			"$teh",
			"/teh",
			"C:\\notes\\teh",
			"https://example.com/teh",
			"my_teh",
			"file.teh",
			"`teh",
			'"teh',
			"```ts\nconst x = 1\nteh",
			"~~~\nteh",
			"git checkout teh",
			"npm run teh",
			"    teh",
			"const x = teh",
			"foo = teh",
		])
			expect(correct(text)).toBeNull();
		expect(getAutocorrection("teh.ts", 3)).toBeNull();
	});
	test("resumes prose corrections after closed code and preserves the caret range", () => {
		expect(correct("`code` and teh")).toBe("the");
		expect(correct("```ts\nconst x = 1\n```\nthen teh")).toBe("the");
		expect(getAutocorrection("fix teh please", 7)).toEqual({
			start: 4,
			word: "teh",
			replacement: "the",
		});
	});
});
