import { useRef, useState } from "react";
import { electronTrpcClient } from "renderer/lib/trpc-client";
import type { ClaudePermissionRequest } from "shared/claude-session/events";
import { ClaudeQuestionForm } from "./components/ClaudeQuestionForm";

export function SessionPermissionRequest({
	sessionKey,
	request,
}: {
	sessionKey: string;
	request: ClaudePermissionRequest;
}) {
	const sending = useRef(false);
	const [busy, setBusy] = useState(false);
	const [sent, setSent] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const isQuestion = request.tool === "AskUserQuestion";
	const answer = async (allow: boolean, answers?: Record<string, string>) => {
		if (sending.current) return;
		sending.current = true;
		setBusy(true);
		setError(null);
		try {
			await electronTrpcClient.claudeSession.answerPermission.mutate({
				key: sessionKey,
				id: request.id,
				allow,
				answers,
			});
			setSent(true);
		} catch (e) {
			setError(
				e instanceof Error ? e.message : "Could not send your response.",
			);
			sending.current = false;
		} finally {
			setBusy(false);
		}
	};
	return (
		<section
			aria-label={isQuestion ? "Claude question" : "Permission request"}
			aria-busy={busy}
			className="min-w-0 rounded-xl border border-border bg-card p-4 text-sm"
		>
			<p className="font-medium text-foreground">
				{isQuestion ? "Claude has a question" : "Claude needs your permission"}
			</p>
			{isQuestion ? (
				<ClaudeQuestionForm
					input={request.input}
					disabled={busy || sent}
					submitLabel={sent ? "Reply sent" : busy ? "Sending…" : "Send answer"}
					onAnswer={answer}
				/>
			) : (
				<>
					<p className="mt-1 break-words text-muted-foreground">
						{request.tool
							.replace(/^mcp__gatedspace_browser__/, "")
							.replaceAll("_", " ")}
					</p>
					<details className="mt-3 text-muted-foreground">
						<summary className="cursor-pointer">Request details</summary>
						<pre className="mt-2 max-h-48 cursor-text overflow-auto whitespace-pre-wrap break-words text-xs select-text">
							{JSON.stringify(request.input, null, 2)}
						</pre>
					</details>
					<div className="mt-4 flex justify-end gap-2">
						<button
							type="button"
							disabled={busy || sent}
							onClick={() => void answer(false)}
							className="rounded-lg border border-border px-3 py-2 hover:bg-accent disabled:opacity-50"
						>
							Decline
						</button>
						<button
							type="button"
							disabled={busy || sent}
							onClick={() => void answer(true)}
							className="rounded-lg bg-primary px-3 py-2 text-primary-foreground hover:opacity-90 disabled:opacity-50"
						>
							{sent ? "Response sent" : busy ? "Submitting…" : "Allow once"}
						</button>
					</div>
				</>
			)}
			{error && (
				<p
					role="alert"
					className="mt-3 cursor-text text-sm text-destructive select-text"
				>
					{error}
				</p>
			)}
		</section>
	);
}
