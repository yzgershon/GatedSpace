import type { ClaudeStreamEvent } from "../../../shared/claude-session/events";
import type { SessionEvents } from "./session-events";

/** Counts actual submitted prompts, not assistant messages or tool/subagent stops. */
export class ClaudeTurnNotifications {
	private pending = new Map<string, string[]>();
	private results = new Set<string>();
	private permissions = new Map<string, number>();
	constructor(private sessions: SessionEvents) {}
	sent(key: string, id: string, text: string) {
		const turns = this.pending.get(key) ?? [];
		turns.push(id);
		this.pending.set(key, turns);
		this.sessions.work(key, id);
		const state = this.sessions.get(key);
		if (state && !state.title)
			this.sessions.bind(
				key,
				state.sessionId ?? "",
				text.trim().split("\n")[0]?.slice(0, 100),
			);
	}
	event(key: string, event: ClaudeStreamEvent) {
		if (event.type === "local_permissions") {
			this.permissions.set(key, event.requests.length);
			if (event.requests.length) this.sessions.status(key, "attention");
			else if (this.pending.get(key)?.length)
				this.sessions.status(key, "working");
		}
		if (event.type !== "result" || event.parent_tool_use_id) return;
		const resultKey = `${key}:${event.uuid}`;
		if (event.uuid && this.results.has(resultKey)) return;
		if (event.uuid) this.results.add(resultKey);
		if (this.results.size > 1000)
			this.results.delete(this.results.values().next().value ?? "");
		const turns = this.pending.get(key);
		if (!turns?.length) return;
		const turn = turns.shift();
		if (!turn) return;
		if (turns.length) return;
		this.sessions.finish(
			key,
			turn,
			// permission_denials is a history of denied tools, not a live request.
			// A successful turn may have recovered from one; only pending requests block.
			event.subtype === "success" && !event.is_error,
			Boolean(this.permissions.get(key)),
		);
	}
	clear(key: string) {
		this.pending.delete(key);
		this.permissions.delete(key);
	}
}
