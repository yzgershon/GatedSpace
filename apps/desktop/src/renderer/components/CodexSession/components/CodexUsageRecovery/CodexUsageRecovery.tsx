import { UsageRecoveryPanel } from "renderer/components/UsageRecoveryPanel";
import { getCodexDraft } from "renderer/lib/codex-session/draft";
import { electronTrpcClient } from "renderer/lib/trpc-client";
import type { CodexSessionState } from "shared/codex-session/types";

export function CodexUsageRecovery({ state }: { state: CodexSessionState }) {
	if (!state.usageRecovery) return null;
	const preferences = () => {
		const { model, effort, fast, plan, permission } = getCodexDraft(state.key);
		return { model, effort, fast, plan, permission };
	};
	return (
		<UsageRecoveryPanel
			key={state.usageRecovery.id}
			recovery={state.usageRecovery}
			onContinue={() =>
				electronTrpcClient.codexSession.continueAfterUsageLimit.mutate({
					key: state.key,
					preferences: preferences(),
				})
			}
			onAutoContinue={(enabled) =>
				electronTrpcClient.codexSession.autoContinueAfterUsageLimit.mutate({
					key: state.key,
					enabled,
					preferences: preferences(),
				})
			}
		/>
	);
}
