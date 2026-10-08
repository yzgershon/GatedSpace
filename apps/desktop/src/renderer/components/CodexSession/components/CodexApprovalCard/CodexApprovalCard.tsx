import {
	ArrowUp,
	Check,
	ChevronRight,
	MessageCircle,
	PencilLine,
	X,
} from "lucide-react";
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
	const [sent, setSent] = useState(false);
	const sending = useRef(false);
	const lastAttempt = useRef({ allow: false, values: answers });
	const [error, setError] = useState("");
	const answer = async (allow: boolean, values = answers) => {
		if (sending.current) return;
		lastAttempt.current = { allow, values };
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
			setSent(true);
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
	const completed = approval.questions.filter((q) =>
		answers[q.id]?.trim(),
	).length;
	return (
		<section
			className={`codex-approval ${approval.questions.length ? "codex-question-card" : ""}`}
			aria-label={approval.title}
			aria-busy={busy && !sent}
		>
			<header>
				<span className="codex-question-mark">
					<MessageCircle size={17} strokeWidth={1.8} />
				</span>
				<strong>
					{approval.questions.length ? "Your input" : approval.title}
				</strong>
				<output className="codex-question-state">
					{sent
						? "Reply sent"
						: busy
							? "Sending..."
							: !approval.questions.length
								? "Permission required"
								: approval.questions.length > 1
									? `${completed} of ${approval.questions.length} answered`
									: "Choose a reply"}
				</output>
				{approval.sourceItemId && !sent && (
					<button
						type="button"
						className="codex-question-dismiss"
						aria-label="Dismiss quick replies"
						title="Dismiss quick replies"
						disabled={busy}
						onClick={() => void answer(false)}
					>
						<X size={15} />
					</button>
				)}
			</header>
			{approval.detail && <p>{approval.detail}</p>}
			{approval.questions.map((question, questionIndex) => (
				<fieldset key={question.id} disabled={busy}>
					<legend>
						{approval.questions.length > 1 && (
							<span className="codex-question-number">{questionIndex + 1}</span>
						)}
						{question.question}
					</legend>
					<div className="codex-question-options">
						{question.options.map((option, index) => {
							const selected =
								!other[question.id] && answers[question.id] === option;
							const recommended = /\s*\(recommended\)\s*$/i.test(option);
							return (
								<button
									type="button"
									key={option}
									className="codex-question-option"
									aria-pressed={selected}
									onClick={() => {
										setOther((prev) => ({ ...prev, [question.id]: false }));
										choose(question.id, option);
									}}
								>
									<span className="codex-choice-index">
										{selected ? <Check size={13} /> : index + 1}
									</span>
									<span className="codex-choice-copy">
										<span>{option.replace(/\s*\(recommended\)\s*$/i, "")}</span>
										{recommended && (
											<span className="codex-choice-recommended">
												{" Recommended"}
											</span>
										)}
										{question.descriptions?.[index] && (
											<small>{question.descriptions[index]}</small>
										)}
									</span>
									<ChevronRight className="codex-choice-arrow" size={15} />
								</button>
							);
						})}
						{question.options.length > 0 && (
							<button
								type="button"
								className="codex-question-option codex-question-other"
								aria-pressed={Boolean(other[question.id])}
								aria-expanded={Boolean(other[question.id])}
								onClick={() => {
									setOther((prev) => ({
										...prev,
										[question.id]: !prev[question.id],
									}));
									setAnswers((prev) => ({ ...prev, [question.id]: "" }));
								}}
							>
								<PencilLine size={15} />
								<span>
									Other{" "}
									<span className="codex-other-hint">Write your own reply</span>
								</span>
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
							{question.secret ? (
								<input
									type="password"
									autoComplete="off"
									aria-label={`Your answer: ${question.question}`}
									value={drafts[question.id] ?? ""}
									onChange={(e) =>
										setDrafts((prev) => ({
											...prev,
											[question.id]: e.target.value,
										}))
									}
								/>
							) : (
								<textarea
									ref={(node) => node?.focus()}
									aria-label={`Your answer: ${question.question}`}
									placeholder="Write your answer"
									value={drafts[question.id] ?? ""}
									rows={2}
									maxLength={10000}
									onChange={(e) =>
										setDrafts((prev) => ({
											...prev,
											[question.id]: e.target.value,
										}))
									}
									onKeyDown={(e) => {
										if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
											e.preventDefault();
											choose(question.id, drafts[question.id] ?? "");
										}
									}}
								/>
							)}
							<button
								type="submit"
								aria-label="Send custom answer"
								title="Send answer (Ctrl+Enter)"
								disabled={!drafts[question.id]?.trim() || busy}
							>
								<ArrowUp size={17} />
							</button>
						</form>
					)}
				</fieldset>
			))}
			{error && (
				<p
					className="select-text cursor-text codex-question-error"
					role="alert"
				>
					{error}
					<button
						type="button"
						onClick={() =>
							void answer(lastAttempt.current.allow, lastAttempt.current.values)
						}
					>
						Retry sending
					</button>
				</p>
			)}
			{approval.questions.length > 0 && !error && !busy && (
				<footer className="codex-question-footer">
					{approval.questions.length === 1
						? "Click an option to send your reply."
						: "Your replies send together after the last question."}
				</footer>
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
