import { randomUUID } from "node:crypto";
import {
	type ClaudeModelChoice,
	parseClaudeModels,
} from "shared/claude-session/models";

/** One local protocol handshake per process, with no prompt or extra CLI. */
export class ClaudeModelCatalog {
	private readonly requestId = randomUUID();
	private result?: Promise<ClaudeModelChoice[]>;
	private settle?: (models: ClaudeModelChoice[]) => void;
	private timer?: ReturnType<typeof setTimeout>;
	private closed = false;

	constructor(
		private readonly write: (payload: unknown) => void,
		private readonly timeoutMs = 8_000,
	) {}

	read(): Promise<ClaudeModelChoice[]> {
		if (this.closed) return Promise.resolve([]);
		if (this.result) return this.result;
		this.result = new Promise((resolve) => {
			this.settle = resolve;
		});
		this.timer = setTimeout(() => this.finish([]), this.timeoutMs);
		try {
			this.write({
				type: "control_request",
				request_id: this.requestId,
				request: { subtype: "initialize" },
			});
		} catch {
			this.finish([]);
		}
		return this.result;
	}

	handle(value: unknown): boolean {
		if (!value || typeof value !== "object") return false;
		const event = value as {
			type?: string;
			response?: {
				request_id?: string;
				subtype?: string;
				response?: { models?: unknown };
			};
		};
		if (
			event.type !== "control_response" ||
			event.response?.request_id !== this.requestId
		)
			return false;
		this.finish(
			event.response.subtype === "success"
				? parseClaudeModels(event.response.response?.models)
				: [],
		);
		return true;
	}

	private finish(models: ClaudeModelChoice[]) {
		clearTimeout(this.timer);
		this.settle?.(models);
		this.settle = undefined;
	}

	dispose() {
		this.closed = true;
		this.finish([]);
	}
}
