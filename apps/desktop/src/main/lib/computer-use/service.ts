import { EventEmitter } from "node:events";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import {
	COMPUTER_IDLE_TIMEOUT_MS,
	type ComputerUseState,
} from "../../../shared/computer-use";
import { type ComputerBackend, WindowsComputerBackend } from "./backend";

/** An explicit, in-memory grant from the desktop UI; agents cannot enable it. */
export class ComputerUseService extends EventEmitter {
	private state: ComputerUseState = { phase: "off" };
	private backend?: ComputerBackend;
	private controller?: AbortController;
	private tools: Tool[] = [];
	private stopping?: Promise<void>;
	private afterClose: ComputerUseState = { phase: "off" };
	private starting?: Promise<ComputerUseState>;
	private grant?: string;
	private idleTimer?: ReturnType<typeof setTimeout>;
	private requestTimer?: ReturnType<typeof setTimeout>;
	constructor(
		private readonly createBackend: () => ComputerBackend = () =>
			new WindowsComputerBackend(),
		private readonly idleTimeout = COMPUTER_IDLE_TIMEOUT_MS,
	) {
		super();
	}
	get() {
		return this.state;
	}
	private publish(state: ComputerUseState) {
		this.state = state;
		this.emit("change", state);
	}
	request(owner: string, reason: string) {
		if (this.grant || this.stopping) {
			if (this.grant === owner) return this.state;
			throw new Error("Computer control is in use by another pane.");
		}
		if (this.state.request && this.state.request.owner !== owner)
			throw new Error(
				"Another pane is waiting for computer control permission.",
			);
		this.publish({ phase: "off", request: { owner, reason } });
		clearTimeout(this.requestTimer);
		this.requestTimer = setTimeout(() => this.dismissRequest(owner), 300_000);
		this.requestTimer.unref?.();
		return this.state;
	}
	dismissRequest(owner: string) {
		if (this.state.request?.owner === owner) {
			clearTimeout(this.requestTimer);
			this.publish({ phase: "off" });
		}
		return this.state;
	}
	private armIdleTimer() {
		clearTimeout(this.idleTimer);
		this.idleTimer = setTimeout(() => {
			if (this.grant) void this.pause(this.grant);
		}, this.idleTimeout);
		this.idleTimer.unref?.();
	}
	async enable(owner: string) {
		if (this.stopping && !this.grant)
			throw new Error(
				"Computer control is still stopping. Try again in a moment.",
			);
		if (this.grant && this.grant !== owner) {
			throw new Error(
				"Another pane has computer control. Stop it there first.",
			);
		}
		this.grant = owner;
		return this.resume(owner);
	}
	private async resume(owner: string): Promise<ComputerUseState> {
		if (this.stopping) await this.stopping;
		this.checkGrant(owner);
		if (this.starting) return this.starting;
		if (this.backend && this.state.phase === "ready") return this.state;
		const starting = this.connect(owner);
		this.starting = starting;
		try {
			return await starting;
		} finally {
			if (this.starting === starting) this.starting = undefined;
		}
	}
	private async connect(owner: string) {
		const backend = this.createBackend();
		clearTimeout(this.requestTimer);
		const controller = new AbortController();
		this.backend = backend;
		this.controller = controller;
		this.publish({ phase: "connecting", owner });
		backend.onDisconnect = () => {
			if (this.backend === backend)
				void this.pause(
					owner,
					"The Windows controller disconnected. The next desktop request will reconnect.",
				);
		};
		try {
			const tools = await backend.start(controller.signal);
			if (controller.signal.aborted || this.backend !== backend) {
				await backend.close();
				return this.state;
			}
			this.tools = tools;
			this.publish({ phase: "ready", owner });
			this.armIdleTimer();
		} catch (error) {
			if (!controller.signal.aborted && this.backend === backend)
				await this.pause(
					owner,
					error instanceof Error
						? error.message
						: "Could not connect to Windows.",
				);
		}
		return this.state;
	}
	stop(error?: string) {
		// Revoke immediately, even if an idle pause is still closing its process.
		this.grant = undefined;
		this.tools = [];
		return this.deactivate(error);
	}
	/** Shut down desktop input/indicators without forgetting this pane's approval. */
	pause(owner: string, error?: string) {
		if (this.grant !== owner) return Promise.resolve();
		return this.deactivate(error, owner);
	}
	private deactivate(error?: string, pausedOwner?: string) {
		clearTimeout(this.idleTimer);
		clearTimeout(this.requestTimer);
		const finalState = (): ComputerUseState =>
			pausedOwner && this.grant === pausedOwner
				? { phase: "paused", owner: pausedOwner, ...(error ? { error } : {}) }
				: error
					? { phase: "error", error }
					: { phase: "off" };
		if (this.stopping) {
			if (!pausedOwner)
				this.afterClose = error ? { phase: "error", error } : { phase: "off" };
			return this.stopping;
		}
		const backend = this.backend;
		this.controller?.abort();
		this.controller = undefined;
		this.backend = undefined;
		this.starting = undefined;
		if (!backend) {
			this.publish(finalState());
			return Promise.resolve();
		}
		this.afterClose = finalState();
		this.stopping = Promise.resolve()
			.then(() => backend.close())
			.catch(() => {})
			.then(() => {
				this.stopping = undefined;
				this.publish(this.afterClose);
			});
		// Keep the visible Stop indicator until the owned process has exited.
		this.publish({ phase: "stopping", owner: this.state.owner });
		return this.stopping;
	}
	release(owner: string) {
		if (this.state.owner === owner) void this.stop();
	}
	private allowed(owner: string) {
		this.checkGrant(owner);
		if (
			this.state.phase !== "ready" ||
			this.state.owner !== owner ||
			!this.backend ||
			!this.controller
		)
			throw new Error(
				this.state.error ??
					"The Windows controller is not ready. Retry the desktop request.",
			);
		return { backend: this.backend, controller: this.controller };
	}
	private checkGrant(owner: string) {
		if (this.grant !== owner)
			throw new Error(
				"Computer control is off for this pane. The user must enable it. Use computer_request to show an Enable button beside the composer, then wait for the user's click.",
			);
	}
	async discover(owner: string) {
		this.checkGrant(owner);
		if (!this.tools.length) {
			await this.resume(owner);
			this.allowed(owner);
		}
		return this.tools;
	}
	async call(
		owner: string,
		name: string,
		args: Record<string, unknown>,
		observeAfter = false,
	): Promise<CallToolResult> {
		this.checkGrant(owner);
		if (this.state.phase !== "ready") await this.resume(owner);
		const { backend, controller } = this.allowed(owner);
		if (!this.tools.some((tool) => tool.name === name))
			throw new Error("This desktop tool is not enabled.");
		if (this.state.activity)
			throw new Error(
				"A desktop action is still running. Wait for its result before acting again.",
			);
		clearTimeout(this.idleTimer);
		this.publish({ ...this.state, activity: name });
		try {
			const result = await backend.call(name, args, controller.signal);
			if (controller.signal.aborted)
				throw new Error("Computer control was stopped.");
			// One action and its fresh observation share a round trip. Never batch
			// actions, replay a click, or scan the accessibility tree unnecessarily.
			if (
				observeAfter &&
				!result.isError &&
				!["Snapshot", "Screenshot", "Wait"].includes(name) &&
				this.tools.some((tool) => tool.name === "Screenshot")
			) {
				const observation = await backend.call(
					"Screenshot",
					{},
					controller.signal,
				);
				if (controller.signal.aborted)
					throw new Error("Computer control was stopped.");
				return {
					...result,
					content: [
						...result.content,
						{ type: "text", text: "Desktop after the action:" },
						...observation.content,
					],
					...(observation.isError ? { isError: true } : {}),
				};
			}
			return result;
		} catch (error) {
			// A timed-out UI action must not keep running after the agent retries.
			if (!controller.signal.aborted)
				await this.pause(
					owner,
					"The desktop action failed or timed out. The controller was closed; the action was not retried. Inspect the screen before continuing.",
				);
			throw error;
		} finally {
			if (this.backend === backend && this.state.phase === "ready") {
				this.publish({ phase: "ready", owner });
				this.armIdleTimer();
			}
		}
	}
}
export const computerUseService = new ComputerUseService();
