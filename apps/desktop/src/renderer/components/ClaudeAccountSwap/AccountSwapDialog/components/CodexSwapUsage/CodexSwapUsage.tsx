import { CodexUsageDetails } from "../../../CodexUsageDetails";
import { useCodexAccountUsage } from "../../../useCodexAccounts";

export function CodexSwapUsage({ id }: { id: string }) {
	const usage = useCodexAccountUsage(id);
	return (
		<span className="mt-1 block">
			{usage.data?.limits && (
				<CodexUsageDetails compact limits={usage.data.limits} />
			)}
			{usage.isError || usage.data?.error ? (
				<span className="text-xs text-muted-foreground">
					{usage.data?.limits ? "Last reported · " : ""}Usage unavailable
				</span>
			) : usage.isPending ? (
				<span className="text-xs text-muted-foreground">Reading usage…</span>
			) : null}
		</span>
	);
}
