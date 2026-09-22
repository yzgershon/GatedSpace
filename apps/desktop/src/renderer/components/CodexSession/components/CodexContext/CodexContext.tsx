import { useSyncExternalStore } from "react";
import {
	getCodexSession,
	subscribeCodexSession,
} from "renderer/lib/codex-session/store";

export function CodexContext({ paneId }: { paneId: string }) {
	const state = useSyncExternalStore(
		(fn) => subscribeCodexSession(paneId, fn),
		() => getCodexSession(paneId),
	);
	if (!state?.contextTokens) return null;
	return (
		<span
			className="text-xs text-muted-foreground tabular-nums"
			title={`${state.contextTokens.toLocaleString()} context tokens${state.contextWindow ? ` of ${state.contextWindow.toLocaleString()}` : ""}`}
		>
			{Math.round(state.contextTokens / 1000)}k
		</span>
	);
}
