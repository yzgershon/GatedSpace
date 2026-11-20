import { describe, expect, test } from "bun:test";
import {
	parseClaudeQuestions,
	validateClaudeQuestionAnswers,
} from "./questions";

describe("Claude clarifying questions", () => {
	const input = {
		questions: [
			{
				question: "Pick a color",
				header: "Color",
				options: [{ label: "Blue" }],
			},
			{ question: "What else?", options: [], multiSelect: false },
		],
	};
	test("reads choices and free-text questions without changing question keys", () => {
		expect(parseClaudeQuestions(input)?.[0].multiSelect).toBe(false);
		expect(parseClaudeQuestions(input)?.[1].options).toEqual([]);
		expect(
			validateClaudeQuestionAnswers(input, {
				"Pick a color": "Blue",
				"What else?": "Keep it simple.",
			}),
		).toEqual({ "Pick a color": "Blue", "What else?": "Keep it simple." });
	});
	test("missing, partial, blank and unrelated answers cannot finish a question", () => {
		const cases: Array<Record<string, string> | undefined> = [
			undefined,
			{},
			{ "Pick a color": "Blue" },
			{ "Pick a color": "Blue", "What else?": " \n " },
			{ Color: "Blue", "What else?": "None" },
			{ "Pick a color": "Blue", "What else?": "None", extra: "wrong request" },
		];
		for (const answers of cases) {
			expect(() => validateClaudeQuestionAnswers(input, answers)).toThrow(
				"Answer each question",
			);
		}
	});
	test("malformed or duplicate questions cannot be silently approved", () => {
		for (const bad of [
			{},
			{ questions: [] },
			{ questions: [{ question: "" }] },
			{ questions: [{ question: "Same" }, { question: "Same" }] },
			{ questions: [{ question: "Choose", options: [{ label: 3 }] }] },
		]) {
			expect(parseClaudeQuestions(bad)).toBeNull();
			expect(() => validateClaudeQuestionAnswers(bad, {})).toThrow(
				"unreadable",
			);
		}
	});
	test("a question named like an object property remains ordinary data", () => {
		const answers = JSON.parse('{"__proto__":"Blue"}');
		expect(
			validateClaudeQuestionAnswers(
				{ questions: [{ question: "__proto__" }] },
				answers,
			),
		).toEqual(answers);
	});
});
