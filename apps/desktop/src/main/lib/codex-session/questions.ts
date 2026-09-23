import { z } from "zod";

export const asyncQuestionInput = z.object({
	session: z.string().min(1),
	questions: z
		.array(
			z.object({
				title: z.string().trim().min(1).max(4000),
				options: z.array(z.string().trim().min(1).max(1000)).max(6).optional(),
			}),
		)
		.min(1)
		.max(3),
});
export type AsyncQuestionInput = z.infer<typeof asyncQuestionInput>;
export const asyncQuestionDescription =
	"Ask the user a question with clickable choices and a custom answer. The card stays visible while you continue independent work. Returns immediately without a user answer. A user's click sends their response into this conversation automatically. Use for clarification or preferences; never interpret the queued result, default choice or elapsed time as an answer or permission. Supply your GatedSpace session key.";
