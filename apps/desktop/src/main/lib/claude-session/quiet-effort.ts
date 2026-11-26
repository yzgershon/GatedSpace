import { stripVTControlCharacters } from "node:util";
import type { ClaudeStreamEvent } from "../../../shared/claude-session/events";

/** Only acknowledgements of our own /effort updates, never a whole captured turn. */
export class QuietEffortUpdates {
	private pending = new Map<string, number>();
	private lastSent?: string;

	track(effort: string) {
		if (this.lastSent === effort) return false;
		this.lastSent = effort;
		this.pending.set(effort, (this.pending.get(effort) ?? 0) + 1);
		return true;
	}
	failed(effort: string) {
		if (this.lastSent === effort) this.lastSent = undefined;
		this.complete(effort);
	}
	manual(effort: string) {
		this.lastSent = effort;
	}
	private complete(effort: string) {
		const remaining = (this.pending.get(effort) ?? 1) - 1;
		if (remaining > 0) this.pending.set(effort, remaining);
		else this.pending.delete(effort);
	}

	consume(event: ClaudeStreamEvent): boolean {
		if ("parent_tool_use_id" in event && event.parent_tool_use_id) return false;
		let text: string;
		if (event.type === "result") {
			// Local slash commands have no model turns. Never swallow real output,
			// errors or their completion event while an effort update is queued.
			if (event.is_error || event.num_turns !== 0) return false;
			text = event.result ?? "";
		} else if (event.type === "assistant") {
			if (event.message.model !== "<synthetic>") return false;
			if (event.message.content.some((b) => b.type !== "text")) return false;
			text = event.message.content
				.map((b) => (b.type === "text" ? b.text : ""))
				.join("");
		} else return false;
		const match =
			/^(?:Set (?:reasoning )?effort(?: level)? to|(?:Reasoning )?effort(?: level)? (?:set|reset) to)\s+(low|medium|high|xhigh|max|auto|ultracode)[.!]?$/i.exec(
				stripVTControlCharacters(text).trim(),
			);
		if (!match || !this.pending.has(match[1].toLowerCase())) return false;
		if (event.type === "result") this.complete(match[1].toLowerCase());
		return true;
	}
}
