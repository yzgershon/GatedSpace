import { useState } from "react";
import { electronTrpcClient } from "renderer/lib/trpc-client";
import type { ClaudePermissionRequest } from "shared/claude-session/events";

export function SessionPermissionRequests({
	sessionKey,
	requests,
}: {
	sessionKey: string;
	requests: ClaudePermissionRequest[];
}) {
	const [busy, setBusy] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const answer = async (id: string, allow: boolean) => {
		setBusy(id);
		setError(null);
		try {
			await electronTrpcClient.claudeSession.answerPermission.mutate({
				key: sessionKey,
				id,
				allow,
			});
		} catch (e) {
			setError(e instanceof Error ? e.message : "Could not submit permission.");
		} finally {
			setBusy(null);
		}
	};
	if (!requests.length) return null;
	return (
		<div className="mx-auto w-full max-w-[960px] space-y-3 px-6 py-4">
			{requests.map((request) => (
				<section
					key={request.id}
					aria-label="Permission request"
					className="rounded-xl border border-border bg-card p-4 text-sm"
				>
					<p className="font-medium text-foreground">
						Claude needs your permission
					</p>
					<p className="mt-1 break-words text-muted-foreground">
						{request.tool
							.replace(/^mcp__gatedspace_browser__/, "")
							.replaceAll("_", " ")}
					</p>
					<details className="mt-3 text-muted-foreground">
						<summary className="cursor-pointer">Request details</summary>
						<pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words select-text cursor-text text-xs">
							{JSON.stringify(request.input, null, 2)}
						</pre>
					</details>
					<div className="mt-4 flex justify-end gap-2">
						<button
							type="button"
							disabled={busy !== null}
							onClick={() => void answer(request.id, false)}
							className="rounded-lg border border-border px-3 py-2 hover:bg-accent disabled:opacity-50"
						>
							Decline
						</button>
						<button
							type="button"
							disabled={busy !== null}
							onClick={() => void answer(request.id, true)}
							className="rounded-lg bg-primary px-3 py-2 text-primary-foreground hover:opacity-90 disabled:opacity-50"
						>
							{busy === request.id ? "Submitting…" : "Allow once"}
						</button>
					</div>
				</section>
			))}
			{error && (
				<p
					role="alert"
					className="select-text cursor-text text-sm text-destructive"
				>
					{error}
				</p>
			)}
		</div>
	);
}
