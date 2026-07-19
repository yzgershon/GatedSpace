import { Button } from "@superset/ui/button";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, GlobeIcon, MonitorPlay } from "lucide-react";
import { useWorkspaceHostUrl } from "renderer/hooks/host-service/useWorkspaceHostUrl";
import { getHostServiceClientByUrl } from "renderer/lib/host-service-client";

/**
 * Right-sidebar Preview tab: the workspace's detected dev-server ports with
 * one-click open into an in-app browser pane, so a visual change can be
 * eyeballed before it gets committed or pushed. Detection rides the existing
 * host port scanner — start a dev server in any terminal and it shows up here.
 */

const PORTS_REFETCH_INTERVAL_MS = 5_000;

interface PreviewTabProps {
	workspaceId: string;
	onOpenUrl?: (url: string) => void;
}

interface PreviewPort {
	port: number;
	label: string | null;
	url: string;
}

function usePreviewPorts(workspaceId: string): {
	ports: PreviewPort[];
	isLoading: boolean;
} {
	const hostUrl = useWorkspaceHostUrl(workspaceId);
	const { data, isLoading } = useQuery({
		queryKey: ["workspace-preview-ports", hostUrl, workspaceId],
		enabled: Boolean(hostUrl),
		// Mounted only while the tab is active, so light polling is fine and
		// keeps the list fresh as dev servers start and stop.
		refetchInterval: PORTS_REFETCH_INTERVAL_MS,
		queryFn: async (): Promise<PreviewPort[]> => {
			if (!hostUrl) return [];
			const client = getHostServiceClientByUrl(hostUrl);
			const ports = await client.ports.getAll.query({
				workspaceIds: [workspaceId],
			});
			return ports
				.map((port) => ({
					port: port.port,
					label: port.label,
					url: `http://localhost:${port.port}`,
				}))
				.sort((a, b) => a.port - b.port);
		},
	});
	return { ports: data ?? [], isLoading };
}

export function PreviewTab({ workspaceId, onOpenUrl }: PreviewTabProps) {
	const { ports, isLoading } = usePreviewPorts(workspaceId);

	return (
		<div className="chat-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto">
			{isLoading ? (
				<div className="p-4 text-center text-xs text-muted-foreground">
					Scanning for dev servers…
				</div>
			) : ports.length === 0 ? (
				<div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
					<MonitorPlay className="size-8 text-muted-foreground/40" />
					<p className="text-xs font-medium text-muted-foreground">
						No dev server detected
					</p>
					<p className="max-w-56 text-[11px] leading-relaxed text-muted-foreground/70">
						Start the project's dev server in a terminal (or ask an agent to).
						Detected ports appear here so you can preview changes before
						committing them.
					</p>
				</div>
			) : (
				<div className="flex flex-col gap-1 p-2">
					<p className="px-1 pb-1 text-[11px] text-muted-foreground/70">
						Preview the running app before you commit or push.
					</p>
					{ports.map((port) => (
						<div
							key={port.port}
							className="flex items-center gap-2 rounded-md border border-border/50 px-2.5 py-2"
						>
							<GlobeIcon className="size-3.5 shrink-0 text-muted-foreground" />
							<div className="min-w-0 flex-1">
								<p className="truncate text-xs text-foreground">
									{port.label ?? `localhost:${port.port}`}
								</p>
								<p className="truncate text-[11px] text-muted-foreground">
									{port.url}
								</p>
							</div>
							<Button
								variant="secondary"
								size="sm"
								className="h-6 gap-1 px-2 text-[11px]"
								onClick={() => onOpenUrl?.(port.url)}
							>
								<ExternalLink className="size-3" />
								Preview
							</Button>
						</div>
					))}
				</div>
			)}
		</div>
	);
}
