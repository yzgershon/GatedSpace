import { useState } from "react";
import { electronTrpcClient } from "renderer/lib/trpc-client";
import type { CodexApproval } from "shared/codex-session/types";

export function CodexApprovalCard({
	sessionKey,
	approval,
}: {
	sessionKey: string;
	approval: CodexApproval;
}) {
	const [answers, setAnswers] = useState<Record<string, string>>({});
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const answer = async (allow: boolean) => {
		setBusy(true);
		try {
			await electronTrpcClient.codexSession.answer.mutate({
				key: sessionKey,
				id: approval.id,
				allow,
				answers,
			});
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
			setBusy(false);
		}
	};
	return (
		<section className="codex-approval" aria-label={approval.title}>
			<strong>{approval.title}</strong>
			<p>{approval.detail}</p>
			{approval.questions.map((question) => (
				<fieldset key={question.id}>
					<legend>{question.question}</legend>
					{question.options.map((option) => (
						<label key={option}>
							<input
								type="radio"
								name={`${approval.id}:${question.id}`}
								checked={answers[question.id] === option}
								onChange={() =>
									setAnswers((prev) => ({ ...prev, [question.id]: option }))
								}
							/>
							{option}
						</label>
					))}
					<input
						aria-label={`Answer: ${question.question}`}
						value={answers[question.id] ?? ""}
						onChange={(e) =>
							setAnswers((prev) => ({ ...prev, [question.id]: e.target.value }))
						}
						placeholder="Your answer"
					/>
				</fieldset>
			))}
			{error && (
				<p className="select-text cursor-text" role="alert">
					{error}
				</p>
			)}
			<div className="codex-approval-actions">
				{!approval.questions.length && (
					<button
						type="button"
						disabled={busy}
						onClick={() => void answer(false)}
					>
						Decline
					</button>
				)}
				<button
					type="button"
					disabled={
						busy || approval.questions.some((q) => !answers[q.id]?.trim())
					}
					onClick={() => void answer(true)}
				>
					{approval.questions.length ? "Send answers" : "Allow once"}
				</button>
			</div>
		</section>
	);
}
