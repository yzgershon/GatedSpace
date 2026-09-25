import { EventEmitter } from "node:events";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import type { ComputerUseState } from "../../../shared/computer-use";
import { type ComputerBackend, WindowsComputerBackend } from "./backend";

/** An explicit, in-memory grant from the desktop UI; agents cannot enable it. */
export class ComputerUseService extends EventEmitter {
	private state: ComputerUseState = { phase: "off" };
	private backend?: ComputerBackend;
	private controller?: AbortController;
	private tools: Tool[] = [];
	private stopping?: Promise<void>;
	constructor(
		private readonly createBackend: () => ComputerBackend = () =>
			new WindowsComputerBackend(),
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
	async enable(owner: string) {
		if (this.state.phase === "stopping")
			throw new Error(
				"Computer control is still stopping. Try again in a moment.",
			);
		if (this.backend) {
			if (this.state.owner === owner) return this.state;
			throw new Error(
				"Another pane has computer control. Stop it there first.",
			);
		}
		const backend = this.createBackend();
		const controller = new AbortController();
		this.backend = backend;
		this.controller = controller;
		this.publish({ phase: "connecting", owner });
		backend.onDisconnect = () => {
			if (this.backend === backend)
				void this.stop(
					"The Windows controller disconnected. Enable it again to reconnect.",
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
		} catch (error) {
			if (!controller.signal.aborted && this.backend === backend)
				await this.stop(
					error instanceof Error
						? error.message
						: "Could not connect to Windows.",
				);
		}
		return this.state;
	}
	stop(error?: string) {
		if (this.stopping) return this.stopping;
		const backend = this.backend;
		this.controller?.abort();
		this.controller = undefined;
		this.backend = undefined;
		this.tools = [];
		if (!backend) {
			this.publish(error ? { phase: "error", error } : { phase: "off" });
			return Promise.resolve();
		}
		this.publish({ phase: "stopping", owner: this.state.owner });
		this.stopping = backend
			.close()
			.catch(() => {})
			.then(() => {
				this.stopping = undefined;
				this.publish(error ? { phase: "error", error } : { phase: "off" });
			});
		return this.stopping;
	}
	release(owner: string) {
		if (this.state.owner === owner) void this.stop();
	}
	private allowed(owner: string) {
		if (
			this.state.phase !== "ready" ||
			this.state.owner !== owner ||
			!this.backend ||
			!this.controller
		)
			throw new Error(
				"Computer control is off for this pane. The user must enable Computer control beside the composer. Do not enable it through scripts or another pane.",
			);
		return { backend: this.backend, controller: this.controller };
	}
	discover(owner: string) {
		this.allowed(owner);
		return this.tools;
	}
	async call(
		owner: string,
		name: string,
		args: Record<string, unknown>,
	): Promise<CallToolResult> {
		const { backend, controller } = this.allowed(owner);
		if (!this.tools.some((tool) => tool.name === name))
			throw new Error("This desktop tool is not enabled.");
		if (this.state.activity)
			throw new Error(
				"A desktop action is still running. Wait for its result before acting again.",
			);
		this.publish({ ...this.state, activity: name });
		try {
			const result = await backend.call(name, args, controller.signal);
			if (controller.signal.aborted)
				throw new Error("Computer control was stopped.");
			return result;
		} catch (error) {
			// A timed-out UI action must not keep running after the agent retries.
			if (!controller.signal.aborted)
				await this.stop(
					"The desktop action failed or timed out. Computer control has stopped.",
				);
			throw error;
		} finally {
			if (this.backend === backend && this.state.phase === "ready")
				this.publish({ phase: "ready", owner });
		}
	}
}
export const computerUseService = new ComputerUseService();
