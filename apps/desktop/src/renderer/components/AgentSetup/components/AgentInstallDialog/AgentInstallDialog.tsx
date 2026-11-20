import { Button } from "@superset/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@superset/ui/dialog";
import { useEffect, useRef, useState } from "react";
import { LuDownload, LuLoaderCircle } from "react-icons/lu";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { electronTrpcClient } from "renderer/lib/trpc-client";
import type { AgentInstallState, SetupAgent } from "shared/agent-install";

export function AgentInstallDialog({
	agent,
	onClose,
	onInstalled,
}: {
	agent: SetupAgent;
	onClose: () => void;
	onInstalled: () => void;
}) {
	const [job, setJob] = useState<AgentInstallState | null>(null);
	const [starting, setStarting] = useState(false);
	const [error, setError] = useState("");
	const active = useRef(true);
	const jobRef = useRef(job);
	jobRef.current = job;
	const done = useRef(onInstalled);
	done.current = onInstalled;
	const busy =
		starting || job?.phase === "installing" || job?.phase === "checking";
	const status = electronTrpc.system.agentInstallStatus.useQuery(
		{ agent },
		{
			enabled: !!job && busy,
			refetchInterval: busy ? 700 : false,
			retry: false,
		},
	);
	useEffect(() => {
		active.current = true;
		return () => {
			active.current = false;
			if (jobRef.current)
				void electronTrpcClient.system.cancelAgentInstall
					.mutate({ agent, id: jobRef.current.id })
					.catch(() => {});
		};
	}, [agent]);
	useEffect(() => {
		if (!status.data || status.data.id !== job?.id) return;
		setJob(status.data);
		if (status.data.phase === "ready") done.current();
	}, [status.data, job?.id]);
	const start = async () => {
		setStarting(true);
		setError("");
		try {
			const next = await electronTrpcClient.system.installAgent.mutate({
				agent,
			});
			if (!active.current) {
				await electronTrpcClient.system.cancelAgentInstall.mutate({
					agent,
					id: next.id,
				});
				return;
			}
			jobRef.current = next;
			setJob(next);
			if (next.phase === "ready") done.current();
		} catch (e) {
			if (active.current)
				setError(e instanceof Error ? e.message : "Could not start setup.");
		} finally {
			if (active.current) setStarting(false);
		}
	};
	const name = agent === "codex" ? "Codex" : "Claude Code";
	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
		>
			<DialogContent className="sm:max-w-[440px]">
				<DialogHeader>
					<DialogTitle>Set up {name}</DialogTitle>
					<DialogDescription>
						GatedSpace installs the official {name} tool on this PC. Next, give
						your account a nickname and sign in in your browser.
					</DialogDescription>
				</DialogHeader>
				<div
					className="rounded-xl border border-border bg-muted/30 p-4 text-sm"
					aria-live="polite"
				>
					{busy ? (
						<div className="flex items-center gap-3">
							<LuLoaderCircle className="size-5 shrink-0 animate-spin motion-reduce:animate-none" />
							<div>
								<p className="font-medium">
									{job?.phase === "checking"
										? "Checking installation…"
										: `Installing ${name}…`}
								</p>
								<p className="mt-1 text-xs text-muted-foreground">
									This may take a few minutes. You can keep using GatedSpace.
								</p>
							</div>
						</div>
					) : (
						<div className="flex items-center gap-3">
							<LuDownload className="size-5 shrink-0" />
							<span>No commands to copy. No restart needed.</span>
						</div>
					)}
				</div>
				{(error || job?.error || status.error) && (
					<p
						role="alert"
						className="select-text cursor-text text-sm text-destructive"
					>
						{error || job?.error || status.error?.message}
					</p>
				)}
				<div className="flex justify-end gap-2">
					<Button variant="ghost" onClick={onClose}>
						{busy ? "Cancel setup" : "Cancel"}
					</Button>
					{!busy && (
						<Button onClick={() => void start()}>
							{job?.phase === "error"
								? "Retry installation"
								: "Install & continue"}
						</Button>
					)}
				</div>
			</DialogContent>
		</Dialog>
	);
}
