import { toast } from "@superset/ui/sonner";
import { useSyncExternalStore } from "react";
import { LuFolder } from "react-icons/lu";
import { electronTrpcClient } from "renderer/lib/trpc-client";
import { getSessionCwd, subscribeSession } from "./sessionStore";

/** The running session directory wins over both the launch and workspace defaults. */
export function SessionFolderChip({
	paneId,
	fallbackCwd,
}: {
	paneId: string;
	fallbackCwd?: string;
}) {
	const sessionCwd = useSyncExternalStore(
		(callback) => subscribeSession(paneId, callback),
		() => getSessionCwd(paneId),
	);
	const cwd = sessionCwd ?? fallbackCwd;
	return (
		<button
			type="button"
			disabled={!cwd}
			aria-label="Open session folder in File Explorer"
			title={
				cwd ? `Open in File Explorer · ${cwd}` : "Session folder unavailable"
			}
			className="flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-40"
			onMouseDown={(event) => event.stopPropagation()}
			onClick={(event) => {
				event.stopPropagation();
				if (cwd)
					void electronTrpcClient.external.openInApp
						.mutate({ path: cwd, app: "finder" })
						.catch((error: unknown) =>
							toast.error(
								error instanceof Error
									? error.message
									: "Could not open session folder",
							),
						);
			}}
		>
			<LuFolder className="size-5" />
		</button>
	);
}
