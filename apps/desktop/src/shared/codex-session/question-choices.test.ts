import { expect, test } from "bun:test";
import { questionChoices } from "./question-choices";

test("recovers the reported format question and numbered/bold choices", () => {
	expect(
		questionChoices(
			"I recommend a widescreen ad.\n\nWhich format do you want?\n\n- Widescreen 16:9\n- Vertical 9:16 like Filtrsoft",
		),
	).toEqual({
		question: "Which format do you want?",
		options: ["Widescreen 16:9", "Vertical 9:16 like Filtrsoft"],
	});
	expect(
		questionChoices("Should we proceed?\n1. **Yes**\n2. **No**\n3. Other…")
			?.options,
	).toEqual(["Yes", "No"]);
});
test("does not turn code, quoted material, ordinary lists or partial lists into questions", () => {
	for (const text of [
		"Edited files:\n- one.ts\n- two.ts",
		"Which?\n- A",
		"Which?\n- A\n- B\nMore explanation.",
		"> Which?\n- A\n- B",
		"```\nWhich?\n- A\n- B\n```",
		"Which?\n- [A](https://example.com)\n- B",
		"Which?\n- A\n- A",
		"I have measured it.\n- Width\n- Height",
		"Have you measured it yet\n- Yes\n- No",
	])
		expect(questionChoices(text)).toBeNull();
});

test("recovers the caliper question with instructions following the question mark", () => {
	const question =
		"Have you taken any caliper measurements yet? If so, paste them here and I’ll use them in the Blender model.";
	expect(
		questionChoices(
			`${question}\n\n• Not yet—use the existing geometry for now\n• Yes—I have measurements to provide`,
		),
	).toEqual({
		question,
		options: [
			"Not yet—use the existing geometry for now",
			"Yes—I have measurements to provide",
		],
	});
});

test("recovers conversational follow-up questions without requiring exact phrasing", () => {
	for (const question of [
		"Did you install it? Select the result below.",
		"Is this the layout you meant? You can describe changes in Other.",
		"Have we included everything?",
		"Can I use these dimensions?",
	]) {
		expect(questionChoices(`${question}\n- Yes\n- No`)?.question).toBe(
			question,
		);
	}
});
