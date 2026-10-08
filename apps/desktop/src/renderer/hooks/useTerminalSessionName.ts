import { useEffect } from "react";
import { electronTrpcClient } from "renderer/lib/trpc-client";
import { useTerminalAgentBinding } from "./host-service/useTerminalAgentBindings";

export function useTerminalSessionName(
	workspaceId: string,
	terminalId: string,
) {
	const binding = useTerminalAgentBinding(workspaceId, terminalId);
	const provider = binding?.agentId;
	const sessionId = binding?.agentSessionId;
	const eventAt = binding?.lastEventAt;
	useEffect(() => {
		if (
			(provider !== "codex" && provider !== "claude") ||
			!sessionId ||
			!eventAt
		)
			return;
		let stopped = false;
		let timer: ReturnType<typeof setTimeout>;
		let attempts = 0;
		const update = async () => {
			try {
				const result =
					await electronTrpcClient.sessionNames.terminalAgent.mutate({
						id: terminalId,
						provider,
						sessionId,
					});
				// Hooks can precede the transcript write. Retry briefly, never a permanent file poll.
				if (result.pending && !stopped && ++attempts < 3)
					timer = setTimeout(update, 1_000);
			} catch (error) {
				console.warn("[session-names] terminal binding failed", error);
			}
		};
		void update();
		return () => {
			stopped = true;
			clearTimeout(timer);
		};
	}, [provider, sessionId, terminalId, eventAt]);
}
