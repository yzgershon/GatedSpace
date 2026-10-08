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
	])
		expect(questionChoices(text)).toBeNull();
});
