import { useEffect, useMemo, useRef } from "react";
import { reconnectingSubscription } from "renderer/lib/reconnecting-subscription";
import { electronTrpcClient } from "renderer/lib/trpc-client";
import type {
	BrowserPanelRequest,
	BrowserPanelResult,
} from "shared/agent-browser";
import { browserRuntimeRegistry } from "../../hooks/usePaneRegistry/components/BrowserPane/browserRuntimeRegistry";
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
		return reconnectingSubscription<BrowserPanelRequest>(
			(observer) =>
				electronTrpcClient.browser.agentOpenRequests.subscribe(
					{ workspaceId },
					observer,
				),
			async (request) => {
				let result: BrowserPanelResult | undefined;
				let failure: string | undefined;
				try {
					result = openAgentBrowserTab(tools, request, (paneId, data) => {
						browserRuntimeRegistry.prepareForAgent(paneId, data, (state) => {
							const current = tools.store.getState().getPane(paneId)?.pane;
							if (current?.kind === "browser")
								tools.store.getState().setPaneData({
									paneId,
									data: {
										...current.data,
										url: state.url,
										pageTitle: state.pageTitle,
										faviconUrl: state.faviconUrl,
									},
								});
						});
					});
				} catch (error) {
					failure = error instanceof Error ? error.message : String(error);
				}
				// A failed acknowledgement reconnects and replays this idempotent
				// request instead of leaving the agent waiting for a lost reply.
				await electronTrpcClient.browser.agentOpened.mutate({
					workspaceId,
					requestId: request.requestId,
					result,
					error: failure,
				});
			},
		);
	}, [tools, workspaceId]);
	return tools;
}
