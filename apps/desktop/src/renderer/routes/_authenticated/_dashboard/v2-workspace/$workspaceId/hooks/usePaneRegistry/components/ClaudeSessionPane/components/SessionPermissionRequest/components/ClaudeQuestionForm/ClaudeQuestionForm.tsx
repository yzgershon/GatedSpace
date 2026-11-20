import { useId, useState } from "react";
import { parseClaudeQuestions } from "shared/claude-session/questions";

export function ClaudeQuestionForm({
	input,
	disabled,
	submitLabel,
	onAnswer,
}: {
	input: Record<string, unknown>;
	disabled: boolean;
	submitLabel: string;
	onAnswer: (allow: boolean, answers?: Record<string, string>) => Promise<void>;
}) {
	const formId = useId();
	const [drafts, setDrafts] = useState<
		Record<number, { choices: string[]; text: string }>
	>({});
	const questions = parseClaudeQuestions(input);
	const answers = Object.fromEntries(
		(questions ?? []).map((question, index) => {
			const draft = drafts[index];
			return [
				question.question,
				[...(draft?.choices ?? []), draft?.text.trim() ?? ""]
					.filter(Boolean)
					.join(", "),
			];
		}),
	);
	const complete = questions?.every(({ question }) =>
		answers[question]?.trim(),
	);
	return (
		<form
			onSubmit={(event) => {
				event.preventDefault();
				if (complete && !disabled) void onAnswer(true, answers);
			}}
			className="mt-4 space-y-5"
		>
			{questions ? (
				questions.map((question, index) => (
					<fieldset
						key={question.question}
						disabled={disabled}
						className="min-w-0 space-y-2"
					>
						<legend className="mb-2 max-w-full break-words font-medium text-foreground select-text">
							{question.question}
						</legend>
						{question.multiSelect && question.options.length > 0 && (
							<p className="text-xs text-muted-foreground">
								Choose all that apply.
							</p>
						)}
						{question.options.map((option) => (
							<label
								key={option.label}
								className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 hover:bg-accent has-[:checked]:border-primary has-[:checked]:bg-primary/10 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary"
							>
								<input
									type={question.multiSelect ? "checkbox" : "radio"}
									name={`${formId}-${index}`}
									checked={
										drafts[index]?.choices.includes(option.label) ?? false
									}
									onChange={(event) => {
										const checked = event.target.checked;
										setDrafts((previous) => {
											const draft = previous[index] ?? {
												choices: [],
												text: "",
											};
											return {
												...previous,
												[index]: {
													choices: question.multiSelect
														? checked
															? [...draft.choices, option.label]
															: draft.choices.filter(
																	(choice) => choice !== option.label,
																)
														: [option.label],
													text: question.multiSelect ? draft.text : "",
												},
											};
										});
									}}
									className="mt-0.5 size-4 shrink-0 accent-primary"
								/>
								<span className="min-w-0 break-words">
									<span className="block font-medium">{option.label}</span>
									{option.description && (
										<span className="mt-1 block text-xs text-muted-foreground">
											{option.description}
										</span>
									)}
								</span>
							</label>
						))}
						<label className="block space-y-2 text-xs text-muted-foreground">
							<span>
								{question.options.length
									? "Or type your own answer"
									: "Your answer"}
							</span>
							<textarea
								aria-label={`Your answer: ${question.question}`}
								value={drafts[index]?.text ?? ""}
								rows={2}
								onChange={(event) => {
									const text = event.target.value;
									setDrafts((previous) => ({
										...previous,
										[index]: {
											choices: question.multiSelect
												? (previous[index]?.choices ?? [])
												: [],
											text,
										},
									}));
								}}
								className="w-full min-w-0 resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary disabled:opacity-60"
							/>
						</label>
					</fieldset>
				))
			) : (
				<p role="alert" className="cursor-text text-destructive select-text">
					This question could not be displayed. Dismiss it and ask Claude to try
					again.
				</p>
			)}
			<div className="flex flex-wrap justify-end gap-2">
				<button
					type="button"
					disabled={disabled}
					onClick={() => void onAnswer(false)}
					className="rounded-lg border border-border px-3 py-2 hover:bg-accent disabled:opacity-50"
				>
					Dismiss question{questions && questions.length > 1 ? "s" : ""}
				</button>
				{questions && (
					<button
						type="submit"
						disabled={disabled || !complete}
						className="rounded-lg bg-primary px-3 py-2 text-primary-foreground hover:opacity-90 disabled:opacity-50"
					>
						{submitLabel}
					</button>
				)}
			</div>
		</form>
	);
}
