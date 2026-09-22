import { useQuery } from "@tanstack/react-query";
import { electronTrpcClient } from "renderer/lib/trpc-client";

export function CodexAccount() {
	const account = useQuery({
		queryKey: ["native-codex-account"],
		queryFn: () => electronTrpcClient.codexSession.account.query(),
		staleTime: 60_000,
		retry: false,
	});
	return (
		<div className="max-w-64 px-2 py-1 text-xs text-muted-foreground">
			<div>Codex account</div>
			<div className="truncate text-foreground" title={account.data?.label}>
				{account.data?.label ||
					(account.data?.signedIn === false
						? "Not signed in · run codex login"
						: "Signed-in CLI account")}
			</div>
			{account.data?.plan && (
				<div className="capitalize">{account.data.plan}</div>
			)}
		</div>
	);
}
