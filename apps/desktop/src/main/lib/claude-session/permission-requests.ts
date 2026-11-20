import type {
	ClaudePermissionRequest,
	LocalPermissionsEvent,
} from "shared/claude-session/events";
import { validateClaudeQuestionAnswers } from "shared/claude-session/questions";

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

	answer(id: string, allow: boolean, answers?: Record<string, string>) {
		const request = this.pending.get(id);
		if (!request) throw new Error("This permission request has expired.");
		const isQuestion = request.tool === "AskUserQuestion";
		if (!isQuestion && answers !== undefined)
			throw new Error("This tool request does not accept question answers.");
		// Keep the original questions/metadata. A plain Allow must never consume a
		// question: Claude needs actual answers in updatedInput to continue.
		const updatedInput =
			allow && isQuestion
				? {
						...request.input,
						answers: validateClaudeQuestionAnswers(request.input, answers),
					}
				: request.input;
		this.write({
			type: "control_response",
			response: {
				subtype: "success",
				request_id: id,
				response: allow
					? { behavior: "allow", updatedInput }
					: {
							behavior: "deny",
							message: isQuestion
								? "The user skipped these questions. Do not assume an answer."
								: "The user declined this request.",
						},
			},
		});
		this.pending.delete(id);
		this.emit();
	}

	dismissQuestions() {
		for (const request of [...this.pending.values()])
			if (request.tool === "AskUserQuestion") this.answer(request.id, false);
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
