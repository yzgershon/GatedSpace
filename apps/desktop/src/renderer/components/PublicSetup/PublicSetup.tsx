import { Button } from "@superset/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@superset/ui/dialog";
import { codexIcon } from "@superset/ui/icons/preset-icons";
import { useState } from "react";
import { LuFolderOpen, LuFolderPlus, LuRefreshCw } from "react-icons/lu";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { useFolderFirstImport } from "renderer/routes/_authenticated/_dashboard/components/AddRepositoryModals/hooks/useFolderFirstImport/useFolderFirstImport";
import { GhAuthTerminal } from "renderer/routes/_authenticated/onboarding/components/GhAuthDialog/GhAuthTerminal";
import { ClaudeLogo } from "renderer/routes/_authenticated/onboarding/providers/components/ClaudeLogo";
import { useOpenNewProjectModal } from "renderer/stores/add-repository-modal";
import { agentSetupCommand, type SetupAgent } from "shared/agent-setup-command";

export function PublicSetup() {
	const [error, setError] = useState<string | null>(null);
	const [opening, setOpening] = useState(false);
	const [setup, setSetup] = useState<{
		agent: SetupAgent;
		command: string;
	} | null>(null);
	const status = electronTrpc.system.agentSetupStatus.useQuery(undefined, {
		staleTime: 30_000,
		retry: false,
	});
	const folder = useFolderFirstImport({ onError: setError });
	const newProject = useOpenNewProjectModal();
	return (
		<div className="h-full overflow-y-auto p-6 sm:p-10">
			<div className="mx-auto max-w-xl space-y-8 py-6">
				<div className="space-y-2">
					<p className="text-xs font-medium uppercase tracking-wider text-primary">
						On this PC
					</p>
					<h1 className="text-2xl font-semibold tracking-tight">
						Your space to build
					</h1>
					<p className="text-sm leading-relaxed text-muted-foreground">
						GatedSpace is ready. Projects and sessions stay on this computer. No
						GatedSpace account or GitHub sign-in is needed.
					</p>
				</div>
				<section className="space-y-3" aria-label="Connect your agents">
					<div className="flex items-center justify-between">
						<h2 className="font-medium">Connect your agents</h2>
						<Button
							variant="ghost"
							size="sm"
							disabled={status.isFetching}
							onClick={() => void status.refetch()}
						>
							<LuRefreshCw className="mr-2 size-3.5" />
							Recheck
						</Button>
					</div>
					<p className="text-sm text-muted-foreground">
						Use your own ChatGPT or Claude account. Setup installs the official
						tool if needed, then opens its sign-in in your browser.
					</p>
					<div className="divide-y divide-border rounded-xl border border-border bg-card">
						{(["codex", "claude"] as const).map((agent) => (
							<div key={agent} className="flex items-center gap-3 p-4">
								{agent === "codex" ? (
									<img src={codexIcon} alt="" className="size-6" />
								) : (
									<ClaudeLogo className="size-6 text-[#D97757]" />
								)}
								<div className="min-w-0 flex-1">
									<div className="font-medium">
										{agent === "codex" ? "Codex" : "Claude Code"}
									</div>
									<div className="text-xs text-muted-foreground">
										{status.isFetching
											? "Checking installation…"
											: status.error
												? "Could not check installation"
												: status.data?.[agent]
													? "Installed · sign in or switch account"
													: "Install once, then sign in"}
									</div>
								</div>
								<Button
									variant="outline"
									disabled={!status.data || status.isFetching}
									onClick={() =>
										setSetup({
											agent,
											command: agentSetupCommand(agent, !status.data?.[agent]),
										})
									}
								>
									{status.data?.[agent] ? "Sign in" : "Set up"}
								</Button>
							</div>
						))}
					</div>
				</section>
				<section className="space-y-3">
					<h2 className="font-medium">Start with a folder</h2>
					<p className="text-sm text-muted-foreground">
						Open any project folder or create a new one. GatedSpace prepares
						local Git history when needed; it never uploads or commits your
						existing files during setup.
					</p>
					<div className="flex flex-wrap gap-2">
						<Button
							disabled={opening}
							onClick={async () => {
								setOpening(true);
								setError(null);
								try {
									await folder.start();
								} finally {
									setOpening(false);
								}
							}}
						>
							<LuFolderOpen className="mr-2 size-4" />
							{opening ? "Opening…" : "Open folder"}
						</Button>
						<Button variant="outline" onClick={() => void newProject()}>
							<LuFolderPlus className="mr-2 size-4" />
							New project
						</Button>
					</div>
				</section>
				{error && (
					<p
						role="alert"
						className="select-text cursor-text text-sm text-destructive"
					>
						{error}
					</p>
				)}
			</div>
			{setup && (
				<Dialog
					open={!!setup}
					onOpenChange={(open) => {
						if (!open) {
							setSetup(null);
							void status.refetch();
						}
					}}
				>
					<DialogContent className="max-w-[780px]">
						<DialogHeader>
							<DialogTitle>
								{setup?.agent === "codex"
									? "Connect Codex"
									: "Connect Claude Code"}
							</DialogTitle>
							<DialogDescription>
								Follow the official installer and browser sign-in below. Close
								this panel when finished. You can retry here if installation or
								sign-in fails.
							</DialogDescription>
						</DialogHeader>
						<div className="h-[320px] min-w-0 overflow-hidden rounded-lg bg-background p-2">
							{setup && (
								<GhAuthTerminal
									key={setup.command}
									command={setup.command}
									onExit={() => void status.refetch()}
								/>
							)}
						</div>
					</DialogContent>
				</Dialog>
			)}
		</div>
	);
}
