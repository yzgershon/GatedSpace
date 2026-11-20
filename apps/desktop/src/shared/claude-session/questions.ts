import { z } from "zod";

const questionSchema = z.object({
	question: z.string().refine((value) => value.trim().length > 0),
	header: z.string().optional(),
	options: z
		.array(
			z.object({
				label: z.string().refine((value) => value.trim().length > 0),
				description: z.string().optional(),
			}),
		)
		.default([]),
	multiSelect: z.boolean().default(false),
});
const inputSchema = z.object({
	questions: z
		.array(questionSchema)
		.min(1)
		.refine(
			(questions) =>
				new Set(questions.map((question) => question.question)).size ===
				questions.length,
		),
});

export type ClaudeQuestion = z.infer<typeof questionSchema>;

export function parseClaudeQuestions(input: Record<string, unknown>) {
	const parsed = inputSchema.safeParse(input);
	return parsed.success ? parsed.data.questions : null;
}

/** Answers use the original question text, not its header or an array index. */
export function validateClaudeQuestionAnswers(
	input: Record<string, unknown>,
	answers: Record<string, string> | undefined,
): Record<string, string> {
	const questions = parseClaudeQuestions(input);
	if (!questions) throw new Error("Claude sent an unreadable question.");
	if (
		!answers ||
		Array.isArray(answers) ||
		Object.keys(answers).length !== questions.length ||
		questions.some(
			({ question }) =>
				!Object.hasOwn(answers, question) ||
				typeof answers[question] !== "string" ||
				!answers[question].trim(),
		)
	) {
		throw new Error("Answer each question before sending your reply.");
	}
	return Object.fromEntries(
		questions.map(({ question }) => [question, answers[question]]),
	);
}
