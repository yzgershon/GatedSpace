import type { ClaudeStreamEvent } from "shared/claude-session/events";

/** A circuit breaker, not a second compaction scheduler. Never sends /compact or continue. */
export class CompactionGuard {
	private events: { id: string; at: number }[] = [];
	observe(event: ClaudeStreamEvent, now = Date.now()): boolean {
		if (
			event.type !== "system" ||
			event.subtype !== "compact_boundary" ||
			event.compact_metadata?.trigger !== "auto" ||
			!event.uuid ||
			event.parent_tool_use_id
		)
			return false;
		this.events = this.events.filter((entry) => now - entry.at < 10 * 60_000);
		if (this.events.some((entry) => entry.id === event.uuid)) return false;
		this.events.push({ id: event.uuid, at: now });
		return this.events.length >= 3;
	}
}
