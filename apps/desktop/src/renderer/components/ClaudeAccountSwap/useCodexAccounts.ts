import {
	type QueryClient,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { electronTrpcClient } from "renderer/lib/trpc-client";

export function useCodexAccounts(enabled = true) {
	return useQuery({
		queryKey: ["agent-accounts", "codex"],
		queryFn: () =>
			electronTrpcClient.agentAccounts.list.query({ provider: "codex" }),
		enabled,
		staleTime: 10_000,
		refetchInterval: 30_000,
		retry: false,
	});
}

export function useCodexAccountUsage(id?: string, model?: string) {
	const client = useQueryClient();
	const query = useQuery({
		queryKey: ["codex-account-usage", id, model],
		queryFn: () =>
			electronTrpcClient.agentAccounts.codexUsage.query({
				id: id ?? "",
				model,
			}),
		enabled: Boolean(id),
		staleTime: 30_000,
		refetchInterval: 60_000,
		refetchIntervalInBackground: false,
		retry: false,
	});
	return { ...query, refresh: () => refreshCodexUsage(client, id, model) };
}

/** Explicit refresh/retry bypasses the main-process throttle, but still coalesces in-flight reads. */
export async function refreshCodexUsage(
	client: QueryClient,
	id?: string,
	model?: string,
) {
	const keys = id
		? [["codex-account-usage", id, model]]
		: client
				.getQueryCache()
				.findAll({ queryKey: ["codex-account-usage"], type: "active" })
				.map((query) => query.queryKey);
	await Promise.allSettled(
		keys.map((queryKey) => {
			const accountId = queryKey[1];
			const selectedModel = queryKey[2];
			if (typeof accountId !== "string") return Promise.resolve();
			return client.fetchQuery({
				queryKey,
				staleTime: 0,
				queryFn: () =>
					electronTrpcClient.agentAccounts.codexUsage.query({
						id: accountId,
						model:
							typeof selectedModel === "string" ? selectedModel : undefined,
						force: true,
					}),
			});
		}),
	);
}
