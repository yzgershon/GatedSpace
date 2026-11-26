import { UsageRecoveryPanel } from "renderer/components/UsageRecoveryPanel";
import { electronTrpcClient } from "renderer/lib/trpc-client";
import type { UsageRecoveryState } from "shared/usage-recovery";

export function ClaudeUsageRecovery({
	paneId,
	recovery,
}: {
	paneId: string;
	recovery: UsageRecoveryState;
}) {
	return (
		<UsageRecoveryPanel
			key={recovery.id}
			recovery={recovery}
			onContinue={() =>
				electronTrpcClient.claudeSession.continueAfterUsageLimit.mutate({
					key: paneId,
				})
			}
			onAutoContinue={(enabled) =>
				electronTrpcClient.claudeSession.autoContinueAfterUsageLimit.mutate({
					key: paneId,
					enabled,
				})
			}
		/>
	);
}
