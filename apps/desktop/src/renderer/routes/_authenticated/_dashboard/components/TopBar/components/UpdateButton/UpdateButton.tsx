/**
 * One click from "a newer build exists" to running it.
 *
 * Uses the shared updater for public releases and local personal installers.
 * Stays hidden when current; manual checks remain in Check for Updates.
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
import { ArrowDownToLine, RotateCw } from "lucide-react";
import { useEffect, useState } from "react";
import { DownloadRing } from "renderer/components/UpdatesPill/DownloadRing";
import { useAutoUpdateStatus } from "renderer/components/UpdatesPill/useAutoUpdateStatus";
import { electronTrpc } from "renderer/lib/electron-trpc";
import {
	getSessionActivity,
	getSessionWorkspaceEntries,
} from "renderer/stores/session-activity";
import { AUTO_UPDATE_STATUS } from "shared/auto-update";

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
	const [isInstalling, setIsInstalling] = useState(false);
	const update = useAutoUpdateStatus();
	const installUpdate = electronTrpc.autoUpdate.install.useMutation({
		onError: (error) => {
			setIsInstalling(false);
			toast.error(`Update failed: ${error.message}`);
		},
	});
	const checkUpdate = electronTrpc.autoUpdate.check.useMutation({
		onError: (error) => toast.error(`Update check failed: ${error.message}`),
	});

	const status = update?.status;
	const ready = status === AUTO_UPDATE_STATUS.READY;
	const downloading = status === AUTO_UPDATE_STATUS.DOWNLOADING;
	const failed = status === AUTO_UPDATE_STATUS.ERROR;
	const pending =
		isInstalling || installUpdate.isPending || checkUpdate.isPending;

	useEffect(() => {
		if (!ready) {
			setIsInstalling(false);
			setConfirmOpen(false);
		}
	}, [ready]);

	// Main checks both channels and sends the current state on subscription,
	// including downloads that finished before the top bar mounted.
	if (!ready && !downloading && !failed) return null;

	const version = update?.version ? ` ${update.version}` : "";
	const percent = update?.progress?.percent;
	const label = pending
		? isInstalling
			? "Installing update…"
			: "Checking for updates…"
		: downloading
			? `Downloading update${version}${percent === undefined ? "" : ` — ${Math.round(percent)}%`}`
			: failed
				? "Retry update"
				: `Update to${version || " latest version"}`;

	const install = () => {
		if (!ready || pending) return;
		setIsInstalling(true);
		installUpdate.mutate();
	};

	const onClick = () => {
		if (pending || downloading) return;
		if (failed) {
			checkUpdate.mutate();
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
						aria-label={label}
						aria-disabled={downloading || pending}
						className="no-drag relative size-8 shrink-0 text-muted-foreground hover:text-foreground"
						disabled={pending}
						onClick={onClick}
						size="icon"
						variant="ghost"
					>
						{downloading ? (
							<DownloadRing percent={percent ?? null} />
						) : failed ? (
							<RotateCw className="size-4 text-amber-500" />
						) : (
							<ArrowDownToLine
								className={
									pending ? "size-4 motion-safe:animate-pulse" : "size-4"
								}
							/>
						)}
						{ready && !pending && (
							<span className="absolute top-1 right-1 flex size-[7px]">
								<span className="absolute inline-flex h-full w-full motion-safe:animate-ping rounded-full bg-green-500 opacity-75" />
								<span className="relative inline-flex size-[7px] rounded-full border border-background bg-green-500" />
							</span>
						)}
					</Button>
				</TooltipTrigger>
				<TooltipContent
					side="bottom"
					showArrow={false}
					className={failed ? "max-w-80 select-text cursor-text" : undefined}
				>
					{failed
						? `${update?.error || "Update failed"} — click to retry`
						: ready && !pending
							? `${label} — quits, installs, reopens`
							: label}
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
						<AlertDialogAction onClick={install} disabled={!ready || pending}>
							Install anyway
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
