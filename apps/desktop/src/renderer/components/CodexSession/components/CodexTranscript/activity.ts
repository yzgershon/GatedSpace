import { displayCommand } from "shared/codex-session/command";
import type {
	CodexItem,
	CodexSessionState,
	CodexTurn,
} from "shared/codex-session/types";

export interface TranscriptTurn {
	id: string;
	users: CodexItem[];
	work: CodexItem[];
	answers: CodexItem[];
	timing?: CodexTurn;
	active: boolean;
}

export function transcriptTurns(state?: CodexSessionState): TranscriptTurn[] {
	if (!state) return [];
	const turns = new Map<string, TranscriptTurn>();
	function get(id: string) {
		let turn = turns.get(id);
		if (!turn) {
			turn = {
				id,
				users: [],
				work: [],
				answers: [],
				timing: state?.turns?.find((t) => t.id === id),
				active: false,
			};
			turns.set(id, turn);
		}
		return turn;
	}
	for (const item of state.items) {
		const turn = get(
			item.turnId ||
				(item.id.startsWith("local-user-") ? "pending" : `history-${item.id}`),
		);
		if (item.kind === "user") turn.users.push(item);
		else if (item.kind === "assistant" && item.phase !== "commentary")
			turn.answers.push(item);
		else if (!(item.activityType === "reasoning" && !item.text.trim()))
			turn.work.push(item);
	}
	if (state.status === "working") {
		const pending = turns.get("pending");
		const active = pending ?? get(state.turnId || "pending");
		active.active = true;
		active.timing ??= {
			id: active.id,
			status: "inProgress",
			startedAt: state.workingSince,
		};
	}
	return [...turns.values()];
}

export function groupActivities(items: CodexItem[]): CodexItem[][] {
	const groups: CodexItem[][] = [];
	for (const item of items) {
		const last = groups.at(-1);
		if (item.kind === "assistant" || !last || last[0].kind === "assistant")
			groups.push([item]);
		else last.push(item);
	}
	return groups;
}

/** Describe observable work, without exposing or inventing private reasoning. */
export function activeWorkLabel(turn: TranscriptTurn): string {
	const current = turn.work.findLast(
		(item) => item.kind === "activity" && item.status === "inProgress",
	);
	if (current) {
		switch (activityKind(current)) {
			case "commandExecution":
				return "Running commands";
			case "read":
				return "Reading files";
			case "search":
				return "Searching files";
			case "fileChange":
				return "Editing files";
			case "webSearch":
				return "Searching the web";
			case "browser":
				return "Using the browser";
			case "imageView":
				return "Viewing an image";
			case "reasoning":
				return "Thinking";
			default:
				return "Working";
		}
	}
	return turn.answers.some((item) => item.status === "inProgress")
		? "Writing response"
		: "Thinking";
}

export function activityKind(item: CodexItem) {
	return item.activityType || "tool";
}

export function activityLabel(item: CodexItem, running = false): string {
	switch (activityKind(item)) {
		case "commandExecution":
			return `${running ? "Running" : "Ran"} ${displayCommand(item.command || item.title || "command")}`;
		case "fileChange": {
			const count = item.changes?.length;
			return `${running ? "Editing" : "Edited"} ${count ? `${count} ${count === 1 ? "file" : "files"}` : "files"}`;
		}
		case "webSearch":
			return running ? "Searching the web" : "Searched the web";
		case "browser": {
			const tool = item.tool || "";
			if (tool === "browser_screenshot")
				return running ? "Capturing browser image" : "Viewed a browser image";
			if (tool === "browser_open")
				return `${running ? "Opening" : "Opened"} ${item.url || "browser"}`;
			return `${running ? "Using" : "Used"} browser · ${tool.replace(/^browser_/, "").replaceAll("_", " ")}`;
		}
		case "read":
			return running ? item.title.replace(/^Read /, "Reading ") : item.title;
		case "search":
			return running
				? item.title.replace(/^Searched /, "Searching ")
				: item.title;
		default:
			return item.title || "Tool activity";
	}
}

export function groupLabel(items: CodexItem[]) {
	const labels = [
		...new Set(
			items.map((item) => {
				switch (activityKind(item)) {
					case "fileChange":
						return "Edited files";
					case "commandExecution":
						return "Ran commands";
					case "read":
						return "Read files";
					case "search":
						return "Searched files";
					case "webSearch":
						return "Searched the web";
					case "browser":
						return "Used browser";
					case "imageView":
						return "Viewed images";
					case "reasoning":
						return "Reasoning summary";
					default:
						return "Used tools";
				}
			}),
		),
	];
	return labels
		.map((label, index) =>
			index ? label[0].toLowerCase() + label.slice(1) : label,
		)
		.join(", ");
}

export function formatDuration(ms: number) {
	const seconds = Math.max(0, Math.floor(ms / 1000));
	if (seconds < 60) return `${seconds}s`;
	return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export function diffStats(changes: CodexItem["changes"]) {
	let added = 0,
		removed = 0;
	for (const change of changes ?? [])
		for (const line of change.diff.split("\n")) {
			if (line.startsWith("+") && !line.startsWith("+++")) added++;
			if (line.startsWith("-") && !line.startsWith("---")) removed++;
		}
	return { added, removed };
}
