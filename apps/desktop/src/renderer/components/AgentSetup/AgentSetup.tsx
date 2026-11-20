import { Button } from "@superset/ui/button";
import { useState } from "react";
import { LuRefreshCw } from "react-icons/lu";
import { usePresetIcon } from "renderer/assets/app-icons/preset-icons";
import { AccountSwapDialog } from "renderer/components/ClaudeAccountSwap/AccountSwapDialog";
import { electronTrpc } from "renderer/lib/electron-trpc";
import type { SetupAgent } from "shared/agent-install";
import { AgentInstallDialog } from "./components/AgentInstallDialog/AgentInstallDialog";

/** Available after onboarding too: opening a project must not hide agent setup. */
export function AgentSetup({
	agent,
	compact = false,
	onReady,
}: {
	agent: SetupAgent;
	compact?: boolean;
	onReady?: () => void;
}) {
	const [installing, setInstalling] = useState(false);
	const [accounts, setAccounts] = useState(false);
	const icon = usePresetIcon(agent);
	const name = agent === "codex" ? "Codex" : "Claude Code";
	const status = electronTrpc.system.agentSetupStatus.useQuery(undefined, {
		staleTime: 10_000,
		retry: false,
	});
	const installed = status.data?.[agent];
	const account = status.data?.accounts[agent];
	const refresh = async () => {
		const next = await status.refetch();
		if (next.data?.[agent] && next.data.accounts[agent].signedIn) onReady?.();
	};
	return (
		<>
			<div
				className={
					compact
						? "inline-flex items-center gap-2"
						: "flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-4"
				}
			>
				{!compact && (
					<>
						<img src={icon} alt="" className="size-6 shrink-0" />
						<div className="min-w-[180px] flex-1">
							<div className="text-sm font-medium">{name} on this PC</div>
							<p className="text-xs text-muted-foreground">
								{status.isFetching
									? "Checking installation and sign-in…"
									: status.error
										? "Could not check setup. Try again."
										: !installed
											? "Install and connect your account to get started"
											: account?.signedIn
												? `Connected · ${account.nickname ?? name}`
												: "Installed · sign in to connect your account"}
							</p>
						</div>
					</>
				)}
				<Button
					size="sm"
					variant="outline"
					disabled={!status.data || status.isFetching}
					onClick={() => (installed ? setAccounts(true) : setInstalling(true))}
				>
					{compact
						? `Set up ${name}`
						: installed
							? account?.signedIn
								? "Manage accounts"
								: "Connect account"
							: "Install & connect"}
				</Button>
				<Button
					size="icon"
					variant="ghost"
					aria-label={`Recheck ${name} installation`}
					disabled={status.isFetching}
					onClick={() => void refresh()}
				>
					<LuRefreshCw className="size-3.5" />
				</Button>
			</div>
			{installing && (
				<AgentInstallDialog
					agent={agent}
					onClose={() => {
						setInstalling(false);
						void refresh();
					}}
					onInstalled={() => {
						setInstalling(false);
						void status.refetch();
						setAccounts(true);
					}}
				/>
			)}
			{accounts && (
				<AccountSwapDialog
					initialProvider={agent}
					startAdding={!account?.signedIn}
					connectOnSignIn
					onClose={() => {
						setAccounts(false);
						void refresh();
					}}
				/>
			)}
		</>
	);
}
