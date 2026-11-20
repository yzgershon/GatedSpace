import { describe, expect, test } from "bun:test";
import type { LocalPermissionsEvent } from "shared/claude-session/events";
import { applyEvent, emptyTimeline } from "shared/claude-session/timeline";
import { PermissionRequests } from "./permission-requests";

describe("Claude stdio permissions", () => {
	test("approval preserves original tool input, publishes and clears replayable UI state", () => {
		const writes: unknown[] = [],
			events: LocalPermissionsEvent[] = [];
		const permissions = new PermissionRequests(
			(v) => writes.push(v),
			(e) => events.push(e),
		);
		const input = { url: "http://localhost:3000" };
		expect(
			permissions.handle({
				type: "control_request",
				request_id: "request1",
				request: { subtype: "can_use_tool", tool_name: "browser_open", input },
			}),
		).toBe(true);
		expect(writes).toHaveLength(0);
		expect(events[0].requests[0].input).toEqual(input);
		permissions.answer("request1", true);
		expect(writes).toEqual([
			{
				type: "control_response",
				response: {
					subtype: "success",
					request_id: "request1",
					response: { behavior: "allow", updatedInput: input },
				},
			},
		]);
		expect(events.reduce(applyEvent, emptyTimeline()).permissions).toEqual([]);
		expect(() => permissions.answer("request1", true)).toThrow("expired");
	});
	test("denial, cancellation and process teardown never grant permissions", () => {
		const writes: unknown[] = [],
			events: LocalPermissionsEvent[] = [];
		const permissions = new PermissionRequests(
			(v) => writes.push(v),
			(e) => events.push(e),
		);
		for (const id of ["deny", "cancel", "exit"])
			permissions.handle({
				type: "control_request",
				request_id: id,
				request: {
					subtype: "can_use_tool",
					tool_name: "Bash",
					input: { command: "test" },
				},
			});
		permissions.answer("deny", false);
		permissions.handle({
			type: "control_cancel_request",
			request_id: "cancel",
		});
		permissions.clear();
		expect(writes).toHaveLength(1);
		expect(JSON.stringify(writes[0])).toContain('"behavior":"deny"');
		expect(events.at(-1)?.requests).toEqual([]);
		expect(() => permissions.answer("exit", true)).toThrow();
	});
	test("questions stay pending on empty Allow, then deliver the exact answers with original input", () => {
		const writes: unknown[] = [],
			events: LocalPermissionsEvent[] = [];
		const permissions = new PermissionRequests(
			(value) => writes.push(value),
			(event) => events.push(event),
		);
		const input = {
			questions: [
				{
					question: "Which output?",
					header: "Output",
					options: [{ label: "Website", description: "In a browser" }],
					multiSelect: false,
				},
				{
					question: "Which features?",
					options: [{ label: "Calendar" }, { label: "Notes" }],
					multiSelect: true,
				},
				{ question: "Anything else?", options: [] },
			],
			metadata: { source: "clarification" },
		};
		permissions.handle({
			type: "control_request",
			request_id: "question",
			request: { subtype: "can_use_tool", tool_name: "AskUserQuestion", input },
		});
		expect(() => permissions.answer("question", true)).toThrow(
			"Answer each question",
		);
		expect(() =>
			permissions.answer("question", true, { "Which output?": "Website" }),
		).toThrow("Answer each question");
		expect(writes).toHaveLength(0);
		expect(events.at(-1)?.requests).toHaveLength(1);
		const answers = {
			"Which output?": "Website",
			"Which features?": "Calendar, Notes",
			"Anything else?": "Use my own colors, please.\nKeep it accessible.",
		};
		permissions.answer("question", true, answers);
		expect(writes).toEqual([
			{
				type: "control_response",
				response: {
					subtype: "success",
					request_id: "question",
					response: { behavior: "allow", updatedInput: { ...input, answers } },
				},
			},
		]);
		expect(input).not.toHaveProperty("answers");
		expect(events.reduce(applyEvent, emptyTimeline()).permissions).toEqual([]);
		expect(() => permissions.answer("question", true, answers)).toThrow(
			"expired",
		);
	});
	test("skip, cancellation and shutdown never invent question answers", () => {
		const writes: unknown[] = [],
			events: LocalPermissionsEvent[] = [];
		const permissions = new PermissionRequests(
			(value) => writes.push(value),
			(event) => events.push(event),
		);
		for (const id of ["skip", "cancel", "stop"])
			permissions.handle({
				type: "control_request",
				request_id: id,
				request: {
					subtype: "can_use_tool",
					tool_name: "AskUserQuestion",
					input: { questions: [{ question: "Choose?" }] },
				},
			});
		permissions.answer("skip", false);
		expect(writes).toEqual([
			{
				type: "control_response",
				response: {
					subtype: "success",
					request_id: "skip",
					response: {
						behavior: "deny",
						message:
							"The user skipped these questions. Do not assume an answer.",
					},
				},
			},
		]);
		permissions.handle({
			type: "control_cancel_request",
			request_id: "cancel",
		});
		expect(() =>
			permissions.answer("cancel", true, { "Choose?": "Blue" }),
		).toThrow("expired");
		permissions.clear();
		expect(() =>
			permissions.answer("stop", true, { "Choose?": "Blue" }),
		).toThrow("expired");
		expect(writes).toHaveLength(1);
		expect(events.at(-1)?.requests).toEqual([]);
	});
	test("question answers cannot change a normal tool permission", () => {
		const writes: unknown[] = [];
		const permissions = new PermissionRequests(
			(value) => writes.push(value),
			() => {},
		);
		permissions.handle({
			type: "control_request",
			request_id: "bash",
			request: {
				subtype: "can_use_tool",
				tool_name: "Bash",
				input: { command: "test" },
			},
		});
		expect(() =>
			permissions.answer("bash", true, { command: "different" }),
		).toThrow("does not accept question answers");
		expect(writes).toHaveLength(0);
		permissions.answer("bash", true);
		expect(writes).toHaveLength(1);
	});
	test("new directions dismiss only questions and preserve tool permissions", () => {
		const writes: unknown[] = [],
			events: LocalPermissionsEvent[] = [];
		const permissions = new PermissionRequests(
			(value) => writes.push(value),
			(event) => events.push(event),
		);
		for (const tool of ["AskUserQuestion", "Bash"])
			permissions.handle({
				type: "control_request",
				request_id: tool,
				request: {
					subtype: "can_use_tool",
					tool_name: tool,
					input: { questions: [{ question: "Choose?" }] },
				},
			});
		permissions.dismissQuestions();
		expect(writes).toHaveLength(1);
		expect(JSON.stringify(writes[0])).toContain('"behavior":"deny"');
		expect(events.at(-1)?.requests.map((r) => r.tool)).toEqual(["Bash"]);
		permissions.dismissQuestions();
		expect(writes).toHaveLength(1);
	});
	test("a failed transport write keeps the question available for retry", () => {
		let fail = true;
		const writes: unknown[] = [];
		const permissions = new PermissionRequests(
			(value) => {
				if (fail) throw new Error("Disconnected");
				writes.push(value);
			},
			() => {},
		);
		permissions.handle({
			type: "control_request",
			request_id: "retry",
			request: {
				subtype: "can_use_tool",
				tool_name: "AskUserQuestion",
				input: { questions: [{ question: "Which?" }] },
			},
		});
		expect(() =>
			permissions.answer("retry", true, { "Which?": "Blue" }),
		).toThrow("Disconnected");
		fail = false;
		permissions.answer("retry", true, { "Which?": "Blue" });
		expect(writes).toHaveLength(1);
	});
});
