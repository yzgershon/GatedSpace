import { Button } from "@superset/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@superset/ui/dialog";
import { useNavigate } from "@tanstack/react-router";
import { type ReactNode, useEffect, useState } from "react";
import {
	LuArrowLeft,
	LuCheck,
	LuFolderOpen,
	LuLoaderCircle,
} from "react-icons/lu";
import { AgentSetup } from "renderer/components/AgentSetup/AgentSetup";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { useFolderFirstImport } from "renderer/routes/_authenticated/_dashboard/components/AddRepositoryModals/hooks/useFolderFirstImport";
import { useHostWorkspaces } from "renderer/routes/_authenticated/providers/HostWorkspacesProvider";
import { useLocalHostService } from "renderer/routes/_authenticated/providers/LocalHostServiceProvider";
import { AccountStep } from "./components/AccountStep";
import { WorkspaceTour } from "./components/WorkspaceTour";
import { firstRunStore, useFirstRun } from "./state";
import "./first-run.css";

const steps = ["Account", "Agents", "Project", "First session"];
const stepNames = ["account", "agents", "workspace", "launch"];

export function FirstRunSetup({ children }: { children: ReactNode }) {
	const setup = useFirstRun((s) => s);
	const { workspaces, isReady, localWorkspacesLoaded } = useHostWorkspaces();
	const { activeHostUrl, hostServiceSettled } = useLocalHostService();
	const navigate = useNavigate();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const agents = electronTrpc.system.agentSetupStatus.useQuery(undefined, {
		enabled: setup.open && setup.step === "agents",
		staleTime: 10_000,
		retry: false,
	});
	const folder = useFolderFirstImport({ onError: setError });
	useEffect(() => {
		if (setup.step !== "detect") return;
		// Never interrupt existing installations or infer an empty PC from a failed host query.
		if (workspaces.length > 0 || localStorage.getItem("lastViewedWorkspaceId"))
			setup.inspect(true);
		else if (isReady && localWorkspacesLoaded) setup.inspect(false);
	}, [
		setup.step,
		setup.inspect,
		workspaces.length,
		isReady,
		localWorkspacesLoaded,
	]);
	const move = (step: "account" | "agents" | "workspace") => {
		setError("");
		setup.go(step);
	};
	const openWorkspace = async (id: string) => {
		await navigate({
			to: "/v2-workspace/$workspaceId",
			params: { workspaceId: id },
		});
	};
	async function chooseFolder() {
		if (busy) return;
		setBusy(true);
		setError("");
		try {
			const result = await folder.start();
			if (!result) return;
			if (!result.mainWorkspaceId)
				throw new Error(
					"The folder was added, but its workspace is not ready. Choose the same folder to retry.",
				);
			// Save after real creation, before navigation, so a restart resumes this workspace.
			setup.workspaceReady(result.mainWorkspaceId, result.repoPath);
			await openWorkspace(result.mainWorkspaceId);
		} catch (e) {
			setError(
				e instanceof Error ? e.message : "Could not open the workspace.",
			);
			setup.go("workspace");
		} finally {
			setBusy(false);
		}
	}
	const current = stepNames.indexOf(setup.step);
	const connected =
		agents.data?.[setup.agent] && agents.data.accounts[setup.agent].signedIn;
	if (setup.step === "complete") return children;
	if (setup.step === "detect") return null;
	if (!setup.open)
		return (
			<Button
				className="first-run-resume"
				variant="secondary"
				onClick={() => {
					setup.resume();
					if (setup.step === "launch" && setup.workspaceId)
						void openWorkspace(setup.workspaceId);
				}}
			>
				Resume setup{" "}
				<span className="text-muted-foreground">{current + 1} / 4</span>
			</Button>
		);
	if (setup.step === "launch" && setup.workspaceId)
		return (
			<WorkspaceTour
				workspaceId={setup.workspaceId}
				agent={setup.agent}
				onBack={() => move("agents")}
				onReturn={() => {
					if (setup.workspaceId) void openWorkspace(setup.workspaceId);
				}}
				onFinish={setup.finish}
				onLater={setup.defer}
			/>
		);
	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open && !busy) setup.defer();
			}}
		>
			<DialogContent
				className="first-run-dialog"
				onInteractOutside={(e) => e.preventDefault()}
			>
				<div className="first-run-brand">
					GatedSpace <span>Getting started</span>
				</div>
				<ol className="first-run-steps" aria-label="Setup progress">
					{steps.map((label, index) => (
						<li
							key={label}
							aria-current={index === current ? "step" : undefined}
						>
							<span>{index < current ? <LuCheck /> : index + 1}</span>
							{label}
						</li>
					))}
				</ol>
				<DialogHeader>
					<DialogTitle className="text-xl">
						{setup.step === "account"
							? "Make yourself at home"
							: setup.step === "agents"
								? "Connect your first agent"
								: "Choose your first project"}
					</DialogTitle>
					<DialogDescription>
						{setup.step === "account"
							? "One account for your GatedSpace devices."
							: setup.step === "agents"
								? "Start with one. You can connect more agents anytime."
								: "Choose the folder you want your agent to work in."}
					</DialogDescription>
				</DialogHeader>
				{setup.step === "account" && (
					<AccountStep onNext={() => move("agents")} />
				)}
				{setup.step === "agents" && (
					<div className="space-y-4">
						<fieldset
							className="first-run-agent-choice"
							aria-label="Your first agent"
						>
							{(["codex", "claude"] as const).map((agent) => (
								<Button
									key={agent}
									variant={setup.agent === agent ? "secondary" : "ghost"}
									aria-pressed={setup.agent === agent}
									onClick={() => setup.chooseAgent(agent)}
								>
									{agent === "codex" ? "Codex" : "Claude Code"}
									{agents.data?.accounts[agent].signedIn && <LuCheck />}
								</Button>
							))}
						</fieldset>
						<AgentSetup key={setup.agent} agent={setup.agent} />
						<p className="text-xs leading-relaxed text-muted-foreground">
							Click Install &amp; connect if needed, give the account a
							nickname, then sign in in your browser. We'll check the
							installation and sign-in before you continue.
						</p>
						<div className="first-run-footer">
							<Button variant="ghost" onClick={() => move("account")}>
								<LuArrowLeft />
								Back
							</Button>
							<Button disabled={!connected} onClick={() => move("workspace")}>
								Continue to project
							</Button>
						</div>
					</div>
				)}
				{setup.step === "workspace" && (
					<div className="space-y-5">
						<div className="first-run-folder">
							<LuFolderOpen />
							<div>
								<strong>Your files stay in their folder</strong>
								<p>
									Code, schoolwork, research, or writing. Choose the project
									folder itself. GatedSpace sets up local version history if
									needed.
								</p>
							</div>
						</div>
						<Button
							className="w-full"
							disabled={busy || !activeHostUrl}
							onClick={() => void chooseFolder()}
						>
							{busy ? (
								<LuLoaderCircle className="animate-spin motion-reduce:animate-none" />
							) : (
								<LuFolderOpen />
							)}
							{busy ? "Opening your workspace…" : "Choose project folder"}
						</Button>
						{!activeHostUrl && (
							<p className="text-sm text-muted-foreground">
								{hostServiceSettled
									? "The local workspace service is unavailable. Reopen setup after restoring the connection."
									: "Starting the local workspace service…"}
							</p>
						)}
						{error && (
							<p
								role="alert"
								className="select-text cursor-text text-sm text-destructive"
							>
								{error}
							</p>
						)}
						<p className="text-xs text-muted-foreground">
							No GitHub account is needed for a local project. Next, we'll point
							to the exact buttons for starting your first conversation.
						</p>
						<div className="first-run-footer">
							<Button
								variant="ghost"
								disabled={busy}
								onClick={() => move("agents")}
							>
								<LuArrowLeft />
								Back
							</Button>
						</div>
					</div>
				)}
				<button
					type="button"
					className="first-run-later"
					disabled={busy}
					onClick={setup.defer}
				>
					Finish setup later · your progress is saved
				</button>
			</DialogContent>
		</Dialog>
	);
}

export function openFirstRunSetup() {
	firstRunStore.getState().resume();
}
