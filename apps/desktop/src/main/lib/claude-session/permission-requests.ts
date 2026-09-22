import type {
	ClaudePermissionRequest,
	LocalPermissionsEvent,
} from "shared/claude-session/events";

/** Stdio approvals stay bound to the original tool input and this process. */
export class PermissionRequests {
	private pending = new Map<string, ClaudePermissionRequest>();
	constructor(
		private write: (value: unknown) => void,
		private publish: (event: LocalPermissionsEvent) => void,
	) {}

	handle(value: unknown): boolean {
		if (!value || typeof value !== "object") return false;
		const event = value as Record<string, unknown>;
		if (event.type === "control_cancel_request") {
			if (
				typeof event.request_id === "string" &&
				this.pending.delete(event.request_id)
			)
				this.emit();
			return true;
		}
		if (event.type !== "control_request") return false;
		if (typeof event.request_id !== "string") return true;
		const request = event.request as Record<string, unknown> | undefined;
		if (
			request?.subtype === "can_use_tool" &&
			typeof request.tool_name === "string" &&
			request.input &&
			typeof request.input === "object" &&
			!Array.isArray(request.input)
		) {
			this.pending.set(event.request_id, {
				id: event.request_id,
				tool: request.tool_name,
				input: request.input as Record<string, unknown>,
			});
			this.emit();
		} else {
			this.write({
				type: "control_response",
				response: {
					subtype: "error",
					request_id: event.request_id,
					error: "This interactive request is not supported in GatedSpace yet.",
				},
			});
		}
		return true;
	}

	answer(id: string, allow: boolean) {
		const request = this.pending.get(id);
		if (!request) throw new Error("This permission request has expired.");
		this.write({
			type: "control_response",
			response: {
				subtype: "success",
				request_id: id,
				response: allow
					? { behavior: "allow", updatedInput: request.input }
					: { behavior: "deny", message: "The user declined this request." },
			},
		});
		this.pending.delete(id);
		this.emit();
	}

	clear() {
		if (!this.pending.size) return;
		this.pending.clear();
		this.emit();
	}
	private emit() {
		this.publish({
			type: "local_permissions",
			requests: [...this.pending.values()],
		});
	}
}
