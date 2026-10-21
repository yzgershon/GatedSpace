import type { SessionTimeline } from "./claude-session/timeline";
import type { CodexSessionState } from "./codex-session/types";

export interface SessionProgress {
	status: "working" | "question" | "complete" | "error" | "idle";
	detail: string;
	events: string[];
	canStop: boolean;
}
const short = (text: string) => text.replace(/\s+/g, " ").trim().slice(0, 180);
export function codexProgress(state: CodexSessionState): SessionProgress {
	const start = state.items.findLastIndex((item) => item.kind === "user");
	const recent = state.items
		.slice(start + 1)
		.filter(
			(item) =>
				item.kind === "assistant" ||
				(item.kind === "activity" && item.activityType !== "reasoning"),
		);
	const events = recent
		.slice(-5)
		.map((item) => short(item.kind === "assistant" ? item.text : item.title))
		.filter(Boolean);
	const status = state.approvals.length
		? "question"
		: state.status === "error"
			? "error"
			: state.status === "working" || state.status === "loading"
				? "working"
				: state.turns?.at(-1)?.status === "completed"
					? "complete"
					: "idle";
	return {
		status,
		canStop: state.status === "working",
		events,
		detail:
			status === "question"
				? "Open the session to reply"
				: status === "error"
					? short(state.error || "Open the session for details")
					: events.at(-1) ||
						(status === "working"
							? "Working on your request"
							: "Your session is open"),
	};
}
export function claudeProgress(timeline: SessionTimeline): SessionProgress {
	const start = timeline.items.findLastIndex((item) => item.kind === "user");
	const recent = timeline.items.slice(start + 1);
	const result = recent.findLast((item) => item.kind === "result");
	const events = recent
		.filter((item) => item.kind === "text" || item.kind === "tool")
		.slice(-5)
		.map((item) =>
			short(
				item.kind === "tool"
					? `${item.status === "running" ? "Running" : item.status === "error" ? "Failed" : "Finished"}: ${item.name}`
					: item.kind === "text"
						? item.text
						: "",
			),
		)
		.filter(Boolean);
	const status = timeline.permissions?.length
		? "question"
		: timeline.status === "error" ||
				(timeline.status !== "streaming" &&
					result?.kind === "result" &&
					result.isError)
			? "error"
			: timeline.status === "streaming"
				? "working"
				: timeline.status === "done" &&
						result?.kind === "result" &&
						!result.isError
					? "complete"
					: "idle";
	return {
		status,
		canStop: timeline.status === "streaming",
		events,
		detail:
			status === "question"
				? "Open the session to reply"
				: status === "error"
					? "Open the session for details"
					: events.at(-1) ||
						(status === "working"
							? "Working on your request"
							: "Your session is open"),
	};
}
