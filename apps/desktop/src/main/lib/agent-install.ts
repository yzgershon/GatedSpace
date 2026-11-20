import { randomUUID } from "node:crypto";
import type { AgentInstallState, SetupAgent } from "../../shared/agent-install";
import { agentSetupStatus } from "./agent-setup-status";
import { runSetupProcess, windowsPowerShell } from "./setup-process";
import { augmentWindowsRuntimePath } from "./windows-runtime-path";

export function agentInstallScript(agent: SetupAgent) {
	const url =
		agent === "codex"
			? "https://chatgpt.com/codex/install.ps1"
			: "https://claude.ai/install.ps1";
	return `$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$env:CODEX_NON_INTERACTIVE = '1'
try { Invoke-RestMethod '${url}' | Invoke-Expression } catch { exit 1 }`;
}

/** Installation is explicit and separate from browser authorization. */
export class AgentInstaller {
	private jobs = new Map<
		SetupAgent,
		{
			state: AgentInstallState;
			controller: AbortController;
			done: Promise<void>;
		}
	>();
	constructor(
		private readonly check = agentSetupStatus,
		private readonly run = runSetupProcess,
		private readonly platform = process.platform,
	) {}
	get(agent: SetupAgent) {
		return this.jobs.get(agent)?.state ?? null;
	}
	start(agent: SetupAgent) {
		if (this.platform !== "win32")
			throw new Error("Automatic agent installation is available on Windows.");
		const previous = this.jobs.get(agent);
		if (previous && ["installing", "checking"].includes(previous.state.phase))
			return previous.state;
		const state: AgentInstallState = {
			id: randomUUID(),
			agent,
			phase: "installing",
		};
		const controller = new AbortController();
		const job = { state, controller, done: Promise.resolve() };
		this.jobs.set(agent, job);
		job.done = this.install(state, controller.signal);
		return { ...state };
	}
	async cancel(agent: SetupAgent, id: string) {
		const job = this.jobs.get(agent);
		if (
			!job ||
			job.state.id !== id ||
			!["installing", "checking"].includes(job.state.phase)
		)
			return;
		job.controller.abort();
		await job.done;
	}
	async close() {
		await Promise.all(
			[...this.jobs.values()].map((job) =>
				this.cancel(job.state.agent, job.state.id),
			),
		);
	}
	private async install(state: AgentInstallState, signal: AbortSignal) {
		try {
			// Reuse an installation made outside GatedSpace while the UI was open.
			if (!(await this.check())[state.agent]) {
				signal.throwIfAborted();
				augmentWindowsRuntimePath(process.env);
				await this.run(
					windowsPowerShell(),
					[
						"-NoLogo",
						"-NoProfile",
						"-NonInteractive",
						"-ExecutionPolicy",
						"Bypass",
						"-EncodedCommand",
						Buffer.from(agentInstallScript(state.agent), "utf16le").toString(
							"base64",
						),
					],
					{ signal, timeout: 600_000 },
				);
			}
			signal.throwIfAborted();
			state.phase = "checking";
			if (!(await this.check())[state.agent])
				throw new Error(
					"The agent could not be started after installation. Retry setup; if Windows security blocked the download, allow the official tool first.",
				);
			signal.throwIfAborted();
			state.phase = "ready";
		} catch (error) {
			state.phase = signal.aborted ? "cancelled" : "error";
			state.error = signal.aborted
				? undefined
				: error instanceof Error
					? error.message
					: "Could not install the agent. Retry setup.";
		}
	}
}
