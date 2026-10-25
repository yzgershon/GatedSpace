import { useQuery } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import {
	getCodexSession,
	subscribeCodexSession,
} from "renderer/lib/codex-session/store";
import { electronTrpcClient } from "renderer/lib/trpc-client";
import { requestAccountSwap } from "renderer/stores/claude-account-swap";

export function CodexAccount({ paneId }: { paneId: string }) {
	const state = useSyncExternalStore(
		(fn) => subscribeCodexSession(paneId, fn),
		() => getCodexSession(paneId),
	);
	const profiles = useQuery({
		queryKey: ["agent-accounts", "codex"],
		queryFn: () =>
			electronTrpcClient.agentAccounts.list.query({ provider: "codex" }),
	});
	const nickname = profiles.data?.accounts.find(
		(a) => a.id === state?.accountId,
	)?.label;
	const account = useQuery({
		queryKey: ["native-codex-account", paneId, state?.accountId],
		queryFn: () =>
			electronTrpcClient.codexSession.account.query({ key: paneId }),
		staleTime: 60_000,
		retry: false,
	});
	return (
		<div className="max-w-64 px-2 py-1 text-xs text-muted-foreground">
			<div>{nickname || "Codex account"}</div>
			<div className="truncate text-foreground" title={account.data?.label}>
				{account.data?.label ||
					(account.data?.signedIn === false
						? "Not signed in · run codex login"
						: "Signed-in CLI account")}
			</div>
			{account.data?.plan && (
				<div className="capitalize">{account.data.plan}</div>
			)}
			<button
				type="button"
				className="mt-2 text-primary hover:underline"
				onClick={() => requestAccountSwap({ kind: "codex", paneKey: paneId })}
			>
				Swap account
			</button>
		</div>
	);
}
