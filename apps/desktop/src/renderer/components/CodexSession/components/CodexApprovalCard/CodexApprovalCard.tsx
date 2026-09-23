import { ArrowUp, MessageCircle } from "lucide-react";
import { useRef, useState } from "react";
import { electronTrpcClient } from "renderer/lib/trpc-client";
import type { CodexApproval } from "shared/codex-session/types";
import "./questions.css";

export function CodexApprovalCard({
	sessionKey,
	approval,
}: {
	sessionKey: string;
	approval: CodexApproval;
}) {
	const [answers, setAnswers] = useState<Record<string, string>>({});
	const [other, setOther] = useState<Record<string, boolean>>({});
	const [drafts, setDrafts] = useState<Record<string, string>>({});
	const [busy, setBusy] = useState(false);
	const sending = useRef(false);
	const lastDecision = useRef(false);
	const [error, setError] = useState("");
	const answer = async (allow: boolean, values = answers) => {
		if (sending.current) return;
		lastDecision.current = allow;
		sending.current = true;
		setBusy(true);
		setError("");
		try {
			await electronTrpcClient.codexSession.answer.mutate({
				key: sessionKey,
				id: approval.id,
				allow,
				answers: values,
			});
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
			sending.current = false;
			setBusy(false);
		}
	};
	const choose = (id: string, value: string) => {
		if (!value.trim() || sending.current) return;
		const next = { ...answers, [id]: value.trim() };
		setAnswers(next);
		if (approval.questions.every((q) => next[q.id]?.trim()))
			void answer(true, next);
	};
	return (
		<section
			className={`codex-approval ${approval.questions.length ? "codex-question-card" : ""}`}
			aria-label={approval.title}
			aria-busy={busy}
		>
			<header>
				<MessageCircle size={16} />
				<strong>
					{approval.questions.length ? "A question for you" : approval.title}
				</strong>
				{busy && <span>Sending…</span>}
			</header>
			{approval.detail && <p>{approval.detail}</p>}
			{approval.questions.map((question) => (
				<fieldset key={question.id} disabled={busy}>
					<legend>{question.question}</legend>
					<div className="codex-question-options">
						{question.options.map((option, index) => (
							<button
								type="button"
								key={option}
								className="codex-question-option"
								aria-pressed={
									!other[question.id] && answers[question.id] === option
								}
								onClick={() => {
									setOther((prev) => ({ ...prev, [question.id]: false }));
									choose(question.id, option);
								}}
							>
								<span className="codex-choice-index">{index + 1}</span>
								<span>
									{option}
									{question.descriptions?.[index] && (
										<small>{question.descriptions[index]}</small>
									)}
								</span>
							</button>
						))}
						{question.options.length > 0 && (
							<button
								type="button"
								className="codex-question-option codex-question-other"
								aria-pressed={Boolean(other[question.id])}
								onClick={() => {
									setOther((prev) => ({
										...prev,
										[question.id]: !prev[question.id],
									}));
									setAnswers((prev) => ({ ...prev, [question.id]: "" }));
								}}
							>
								Other…
							</button>
						)}
					</div>
					{(other[question.id] || !question.options.length) && (
						<form
							className="codex-question-custom"
							onSubmit={(e) => {
								e.preventDefault();
								choose(question.id, drafts[question.id] ?? "");
							}}
						>
							<input
								type={question.secret ? "password" : "text"}
								aria-label={`Your answer: ${question.question}`}
								placeholder="Type your own answer…"
								value={drafts[question.id] ?? ""}
								onChange={(e) =>
									setDrafts((prev) => ({
										...prev,
										[question.id]: e.target.value,
									}))
								}
							/>
							<button
								type="submit"
								aria-label="Send custom answer"
								disabled={!drafts[question.id]?.trim() || busy}
							>
								<ArrowUp size={16} />
							</button>
						</form>
					)}
				</fieldset>
			))}
			{error && (
				<p className="select-text cursor-text" role="alert">
					{error}
					<button
						type="button"
						onClick={() => void answer(lastDecision.current)}
					>
						Retry
					</button>
				</p>
			)}
			{!approval.questions.length && (
				<div className="codex-approval-actions">
					<button
						type="button"
						disabled={busy}
						onClick={() => void answer(false)}
					>
						Decline
					</button>
					<button
						type="button"
						disabled={busy}
						onClick={() => void answer(true)}
					>
						Allow once
					</button>
				</div>
			)}
		</section>
	);
}
