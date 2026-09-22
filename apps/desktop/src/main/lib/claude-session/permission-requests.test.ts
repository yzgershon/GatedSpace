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
});
