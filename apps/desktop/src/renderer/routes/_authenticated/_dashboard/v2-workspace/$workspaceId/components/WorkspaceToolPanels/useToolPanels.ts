import { useEffect, useMemo, useRef } from "react";
import type { TerminalLauncher } from "../../hooks/useV2TerminalLauncher";
import { createToolPanels } from "./tool-panel-store";

export function useToolPanels(
	workspaceId: string,
	host: string | null,
	launcher: TerminalLauncher,
) {
	const launcherRef = useRef(launcher);
	launcherRef.current = launcher;
	const tools = useMemo(
		() =>
			createToolPanels({
				key: `gatedspace:workspace-tools:v1:${encodeURIComponent(host ?? "local")}:${workspaceId}`,
				storage: window.localStorage,
				createTerminal: () => launcherRef.current.create(),
			}),
		[host, workspaceId],
	);
	useEffect(() => tools.connect(), [tools]);
	return tools;
}
