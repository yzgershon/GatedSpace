import { expect, test } from "bun:test";
import { insertDictation } from "./insert-dictation";

test("dictation replaces the original selection and preserves surrounding text", () => {
	expect(
		insertDictation(
			"Hello old world",
			{ text: "Hello old world", start: 6, end: 9 },
			"new",
		),
	).toBe("Hello new world");
});
test("typing during dictation is never overwritten", () => {
	expect(
		insertDictation(
			"Revised draft",
			{ text: "Old draft", start: 0, end: 3 },
			"spoken text",
		),
	).toBe("Revised draft spoken text");
	expect(
		insertDictation("Draft", { text: "Draft", start: 2, end: 2 }, ""),
	).toBe("Draft");
});
