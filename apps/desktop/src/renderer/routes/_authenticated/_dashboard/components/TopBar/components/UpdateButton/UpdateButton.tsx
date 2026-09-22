/**
 * One click from "a newer build exists" to running it.
 *
 * Always offers a manual check; a completed personal installer adds a badge
 * and changes the action to install and restart.
 *
 * The dot is the same green the tab status dots use for "done, go look". A
 * finished build is exactly that, and reusing the colour means the window has
 * one vocabulary rather than two.
 */
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@superset/ui/alert-dialog";
import { Button } from "@superset/ui/button";
import { toast } from "@superset/ui/sonner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@superset/ui/tooltip";
import { ArrowDownToLine } from "lucide-react";
import { useState } from "react";
import { electronTrpc } from "renderer/lib/electron-trpc";
import {
	getSessionActivity,
	getSessionWorkspaceEntries,
} from "renderer/stores/session-activity";

/** How often to look for a new installer on disk. Cheap: one readdir. */
const CHECK_INTERVAL_MS = 30_000;

/**
 * Titles of the sessions that would be killed by installing right now.
 *
 * Read at click time rather than subscribed to: this only matters in the
 * instant between the click and the dialog, and subscribing would re-render
 * the top bar on every token of every streaming session.
 */
function streamingSessionCount(): number {
	let count = 0;
	for (const [paneId] of getSessionWorkspaceEntries()) {
		if (getSessionActivity(paneId)?.status === "streaming") count++;
	}
	return count;
}

export function UpdateButton() {
	const [confirmOpen, setConfirmOpen] = useState(false);
	const [busySessions, setBusySessions] = useState(0);

	const { data: update } = electronTrpc.autoUpdate.checkPersonal.useQuery(
		undefined,
		{
			refetchInterval: CHECK_INTERVAL_MS,
			refetchOnWindowFocus: true,
			// A missing config file is the normal state, not an error worth
			// retrying in a loop.
			retry: false,
		},
	);
	const installPersonal = electronTrpc.autoUpdate.installPersonal.useMutation({
		onError: (error) => toast.error(`Update failed: ${error.message}`),
	});

	const check = electronTrpc.autoUpdate.checkInteractive.useMutation({
		onError: (error) => toast.error(`Update check failed: ${error.message}`),
	});
	const pending = installPersonal.isPending || check.isPending;

	const install = () => {
		if (update) installPersonal.mutate({ installerPath: update.installerPath });
	};

	const onClick = () => {
		if (!update) {
			check.mutate();
			return;
		}
		const busy = streamingSessionCount();
		// Installing quits the app, and any Claude Code session running INSIDE
		// GatedSpace dies with it, mid-turn, losing whatever it was part-way
		// through. Worth a question; not worth a question when nothing is running.
		if (busy > 0) {
			setBusySessions(busy);
			setConfirmOpen(true);
			return;
		}
		install();
	};

	return (
		<>
			<Tooltip>
				<TooltipTrigger asChild>
					<Button
						aria-label={
							update ? `Update to ${update.version}` : "Check for updates"
						}
						className="no-drag relative size-8 shrink-0 text-muted-foreground hover:text-foreground"
						disabled={pending}
						onClick={onClick}
						size="icon"
						variant="ghost"
					>
						{/*
						 * A download-to-line arrow, not a refresh spiral. Refresh means
						 * reload; this installs a build. It also has an empty top-right
						 * corner, which is where the notification dot sits — a circular
						 * icon puts its own stroke under the badge and the two smear
						 * together at 16px.
						 */}
						<ArrowDownToLine
							className={pending ? "size-4 animate-pulse" : "size-4"}
						/>
						{update && !pending && (
							<span className="absolute top-1 right-1 flex size-[7px]">
								<span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500 opacity-75" />
								<span className="relative inline-flex size-[7px] rounded-full border border-background bg-green-500" />
							</span>
						)}
					</Button>
				</TooltipTrigger>
				<TooltipContent side="bottom" showArrow={false}>
					{installPersonal.isPending
						? "Installing…"
						: update
							? `Update to ${update.version} — quits, installs, reopens`
							: "Check for updates"}
				</TooltipContent>
			</Tooltip>

			<AlertDialog onOpenChange={setConfirmOpen} open={confirmOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							{busySessions === 1
								? "A session is still working"
								: `${busySessions} sessions are still working`}
						</AlertDialogTitle>
						<AlertDialogDescription>
							Installing {update?.version} closes GatedSpace, and any agent
							running inside it stops mid-turn. Their transcripts are kept, but
							whatever they were part-way through will not finish.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Wait</AlertDialogCancel>
						<AlertDialogAction onClick={install}>
							Install anyway
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
