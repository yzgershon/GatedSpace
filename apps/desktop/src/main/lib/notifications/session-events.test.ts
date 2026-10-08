import { describe, expect, test } from "bun:test";
import type { ResultEvent } from "../../../shared/claude-session/events";
import type { SessionNotificationState } from "../../../shared/session-notifications";
import { ClaudeTurnNotifications } from "./claude-turn-notifications";
import { SessionEvents } from "./session-events";

function fixture() {
	const sessions = new SessionEvents();
	const notices: SessionNotificationState[] = [];
	sessions.on("notice", (state: SessionNotificationState) =>
		notices.push(state),
	);
	sessions.open("pane", "claude", "workspace");
	sessions.bind("pane", "session", "Original title");
	return { sessions, notices, claude: new ClaudeTurnNotifications(sessions) };
}
const result = (
	uuid: string,
	extra: Partial<ResultEvent> = {},
): ResultEvent => ({
	type: "result",
	subtype: "success",
	is_error: false,
	result: "Done",
	session_id: "session",
	uuid,
	num_turns: 1,
	duration_ms: 10,
	duration_api_ms: 5,
	total_cost_usd: 0,
	stop_reason: "end_turn",
	terminal_reason: "success",
	usage: {},
	modelUsage: {},
	permission_denials: [],
	api_error_status: null,
	...extra,
});
describe("authoritative session completion", () => {
	test("history, child results and duplicate results never produce extra completions", () => {
		const { sessions, notices, claude } = fixture();
		claude.event("pane", result("replay"));
		claude.sent("pane", "prompt", "Work");
		claude.event("pane", result("child", { parent_tool_use_id: "tool" }));
		expect(notices).toHaveLength(0);
		expect(sessions.get("pane")?.status).toBe("working");
		claude.event("pane", result("final"));
		claude.event("pane", result("final"));
		expect(notices).toHaveLength(1);
		expect(notices[0]?.status).toBe("completed");
	});
	test("a queued second prompt prevents the first result from announcing finished", () => {
		const { sessions, notices, claude } = fixture();
		claude.sent("pane", "first", "First");
		claude.sent("pane", "second", "Second");
		claude.event("pane", result("r1"));
		expect(notices).toHaveLength(0);
		expect(sessions.get("pane")?.status).toBe("working");
		claude.event("pane", result("r2"));
		expect(notices).toHaveLength(1);
	});
	test("interruptions, failures and late old-turn completions are never success", () => {
		const { sessions, notices, claude } = fixture();
		claude.sent("pane", "first", "Work");
		claude.clear("pane");
		sessions.status("pane", "idle");
		claude.event("pane", result("late"));
		claude.sent("pane", "second", "Work");
		claude.event("pane", result("failed", { is_error: true }));
		sessions.work("pane", "new");
		sessions.finish("pane", "old", true);
		expect(notices).toHaveLength(0);
		expect(sessions.get("pane")?.status).toBe("working");
	});
	test("questions turn red without a completion; answering resumes work", () => {
		const { sessions, notices, claude } = fixture();
		claude.sent("pane", "prompt", "Work");
		claude.event("pane", {
			type: "local_permissions",
			requests: [{ id: "q", tool: "AskUserQuestion", input: {} }],
		});
		expect(notices.map((n) => n.status)).toEqual(["attention"]);
		claude.event("pane", { type: "local_permissions", requests: [] });
		expect(sessions.get("pane")?.status).toBe("working");
	});
	test("the user-renamed session title survives transport titles and hooks stay owned", () => {
		const { sessions, notices } = fixture();
		sessions.context("pane", {
			title: "Filtrsoft audit",
			workspaceId: "workspace",
			visible: false,
		});
		sessions.work("pane", "turn");
		sessions.bind("pane", "session", "Provider title");
		sessions.finish("pane", "turn", true);
		expect(notices[0]?.title).toBe("Filtrsoft audit");
		expect(sessions.owns(undefined, "session")).toBe(true);
		sessions.close("pane");
		expect(sessions.owns(undefined, "session")).toBe(true);
	});
	test("an unresolved async question remains attention even after a successful turn event", () => {
		const { sessions, notices } = fixture();
		sessions.work("pane", "turn");
		sessions.status("pane", "attention");
		sessions.finish("pane", "turn", true, true);
		expect(notices.map((n) => n.status)).toEqual(["attention"]);
		expect(sessions.get("pane")?.status).toBe("attention");
	});
});
