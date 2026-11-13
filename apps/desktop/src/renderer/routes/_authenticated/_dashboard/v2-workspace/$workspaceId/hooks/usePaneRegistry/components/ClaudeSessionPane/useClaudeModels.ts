import { useEffect, useState } from "react";
import { electronTrpcClient } from "renderer/lib/trpc-client";
import type { ClaudeModelChoice } from "shared/claude-session/models";

/** Lazy, process-cached metadata. Opening a menu never sends a user turn. */
export function useClaudeModels(
	key: string | undefined,
	accountId: string | null | undefined,
	open: boolean,
) {
	const [result, setResult] = useState<{
		key: string;
		accountId: string | null | undefined;
		models: ClaudeModelChoice[];
	} | null>(null);
	useEffect(() => {
		if (!key || !open) return;
		let current = true;
		void electronTrpcClient.claudeSession.models
			.query({ key })
			.then((result) => {
				if (current) setResult({ key, accountId, models: result });
			})
			.catch(() => {
				/* Older/disconnected runtimes retain the alias picker. */
				if (current) setResult(null);
			});
		return () => {
			current = false;
		};
	}, [key, accountId, open]);
	return result && result.key === key && result.accountId === accountId
		? result.models
		: [];
}
