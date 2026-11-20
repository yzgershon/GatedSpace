import { PermissionRequests } from "../../src/main/lib/claude-session/permission-requests";
import type { ClaudePermissionRequest } from "../../src/shared/claude-session/events";

const listeners = new Set<(requests: ClaudePermissionRequest[]) => void>();
let current: ClaudePermissionRequest[] = [];
export const fixture = {
	writes: [] as unknown[],
	attempts: [] as unknown[],
	rejectNext: false,
	holdReply: false,
	listen(callback: (requests: ClaudePermissionRequest[]) => void) {
		listeners.add(callback);
		callback(current);
		return () => {
			listeners.delete(callback);
		};
	},
	reset(kind: string) {
		permissions.clear();
		fixture.writes = [];
		fixture.attempts = [];
		fixture.rejectNext = false;
		fixture.holdReply = false;
		const color = {
			question: "Which color should I use?",
			header: "Color",
			options: [
				{ label: "Blue", description: "Use the Codex blue." },
				{ label: "Pink", description: "Use the Dracula accent." },
			],
			multiSelect: false,
		};
		const input =
			kind === "invalid"
				? { questions: [] }
				: kind === "tool"
					? { command: "bun test" }
					: {
							questions:
								kind === "multiple"
									? [
											color,
											{
												question: "Which features should I include?",
												header: "Features",
												options: [{ label: "Calendar" }, { label: "Notes" }],
												multiSelect: true,
											},
										]
									: kind === "text"
										? [{ question: "What should I call it?", options: [] }]
										: [color],
							metadata: { fixture: true },
						};
		permissions.handle({
			type: "control_request",
			request_id: kind,
			request: {
				subtype: "can_use_tool",
				tool_name: kind === "tool" ? "Bash" : "AskUserQuestion",
				input,
			},
		});
	},
	cancel() {
		permissions.handle({
			type: "control_cancel_request",
			request_id: current[0]?.id,
		});
	},
};
const permissions = new PermissionRequests(
	(value) => {
		fixture.writes.push(value);
	},
	(event) => {
		current = event.requests;
		for (const listener of listeners) listener(current);
	},
);
export const electronTrpcClient = {
	claudeSession: {
		answerPermission: {
			async mutate(input: {
				key: string;
				id: string;
				allow: boolean;
				answers?: Record<string, string>;
			}) {
				fixture.attempts.push(input);
				await new Promise((resolve) => setTimeout(resolve, 80));
				if (fixture.rejectNext) {
					fixture.rejectNext = false;
					throw new Error(
						"Connection interrupted. Your answer is kept; try sending again.",
					);
				}
				if (!fixture.holdReply)
					permissions.answer(input.id, input.allow, input.answers);
				return { ok: true };
			},
		},
	},
};
