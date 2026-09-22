import { useEffect, useMemo, useRef } from "react";
import { electronTrpcClient } from "renderer/lib/trpc-client";
import type { TerminalLauncher } from "../../hooks/useV2TerminalLauncher";
import type { SessionPaneData } from "../../types";
import { openAgentBrowserTab } from "./agent-browser-tab";
import { createToolPanels } from "./tool-panel-store";

export function useToolPanels(
	workspaceId: string,
	host: string | null,
	launcher: TerminalLauncher,
	getSessionData?: () => SessionPaneData,
) {
	const sessionDataRef = useRef(getSessionData);
	sessionDataRef.current = getSessionData;
	const launcherRef = useRef(launcher);
	launcherRef.current = launcher;
	const tools = useMemo(
		() =>
			createToolPanels({
				key: `gatedspace:workspace-tools:v1:${encodeURIComponent(host ?? "local")}:${workspaceId}`,
				storage: window.localStorage,
				createTerminal: () => launcherRef.current.create(),
				getSessionData: () => sessionDataRef.current?.() ?? {},
			}),
		[host, workspaceId],
	);
	useEffect(() => tools.connect(), [tools]);
	useEffect(() => {
		const subscription = electronTrpcClient.browser.agentOpenRequests.subscribe(
			{ workspaceId },
			{
				onData: (request) => {
					try {
						openAgentBrowserTab(tools, request);
						void electronTrpcClient.browser.agentOpened.mutate({
							workspaceId,
							requestId: request.requestId,
						});
					} catch (error) {
						void electronTrpcClient.browser.agentOpened.mutate({
							workspaceId,
							requestId: request.requestId,
							error: error instanceof Error ? error.message : String(error),
						});
					}
				},
			},
		);
		return () => subscription.unsubscribe();
	}, [tools, workspaceId]);
	return tools;
}
