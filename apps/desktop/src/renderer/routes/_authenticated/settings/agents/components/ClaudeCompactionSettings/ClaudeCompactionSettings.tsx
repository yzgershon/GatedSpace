import { Button } from "@superset/ui/button";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { ClaudeCompactionForm } from "./ClaudeCompactionForm";

export function ClaudeCompactionSettings() {
	const utils = electronTrpc.useUtils();
	const query = electronTrpc.claudeCompaction.get.useQuery();
	const mutation = electronTrpc.claudeCompaction.set.useMutation({
		onSuccess: (state) => utils.claudeCompaction.get.setData(undefined, state),
	});
	if (query.error)
		return (
			<div className="space-y-2">
				<p
					role="alert"
					className="text-sm text-destructive select-text cursor-text"
				>
					{query.error.message}
				</p>
				<Button
					variant="outline"
					size="sm"
					onClick={() => void query.refetch()}
				>
					Retry compaction settings
				</Button>
			</div>
		);
	if (!query.data)
		return (
			<p className="text-sm text-muted-foreground">
				Loading compaction settings…
			</p>
		);
	return (
		<ClaudeCompactionForm
			key={JSON.stringify(query.data)}
			state={query.data}
			saving={mutation.isPending}
			error={mutation.error?.message}
			saved={mutation.isSuccess}
			onSave={(preference) => mutation.mutate(preference)}
		/>
	);
}
