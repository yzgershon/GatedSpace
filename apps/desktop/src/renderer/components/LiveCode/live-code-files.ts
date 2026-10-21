import { claudeFileChange } from "shared/claude-session/changes";
import type { TimelineItem } from "shared/claude-session/timeline";
import { splitTurnDiff } from "shared/codex-session/review";
import type { CodexSessionState } from "shared/codex-session/types";

export interface LiveCodeFile {
	path: string;
	revision: string;
	deleted?: boolean;
}

export function codexLiveFiles(state?: CodexSessionState): LiveCodeFile[] {
	if (!state) return [];
	const prompt = state.items.findLast((item) => item.kind === "user");
	const turnId = state.status === "working" ? state.turnId : prompt?.turnId;
	if (!turnId) return [];
	const paths = new Map<string, LiveCodeFile>();
	for (const item of state.items) {
		if (
			item.turnId !== turnId ||
			["failed", "declined"].includes(item.status ?? "")
		)
			continue;
		for (const change of item.changes ?? []) {
			paths.delete(change.path);
			paths.set(change.path, {
				path: change.path,
				revision: `${item.id}:${item.status}:${change.diff}`,
				deleted: change.kind === "delete",
			});
		}
	}
	for (const file of splitTurnDiff(
		state.turns?.find((turn) => turn.id === turnId)?.diff ?? "",
	)) {
		if (!paths.has(file.path))
			paths.set(file.path, {
				path: file.path,
				revision: file.diff,
				deleted: file.kind === "delete",
			});
	}
	return [...paths.values()];
}

export function claudeLiveFiles(items: TimelineItem[]): LiveCodeFile[] {
	const paths = new Map<string, LiveCodeFile>();
	for (const item of items.slice(
		items.findLastIndex((item) => item.kind === "user") + 1,
	)) {
		if (item.kind !== "tool" || item.status === "error") continue;
		const change = item.fileChange ?? claudeFileChange(item);
		if (!change) continue;
		paths.delete(change.path);
		paths.set(change.path, {
			path: change.path,
			revision: `${item.toolUseId}:${item.status}:${JSON.stringify(item.input)}`,
		});
	}
	return [...paths.values()];
}

export function absoluteCodePath(cwd: string, path: string) {
	const normalized = path.replaceAll("\\", "/");
	return /^(?:[a-z]:\/|\/)/i.test(normalized)
		? normalized
		: `${cwd.replaceAll("\\", "/").replace(/\/$/, "")}/${normalized}`;
}

/** A display-only replacement. The filesystem and agent never wait on it. */
export function codeReplacement(previous: string, next: string) {
	let from = 0,
		end = previous.length,
		nextEnd = next.length;
	while (from < end && from < nextEnd && previous[from] === next[from]) from++;
	while (
		end > from &&
		nextEnd > from &&
		previous[end - 1] === next[nextEnd - 1]
	) {
		end--;
		nextEnd--;
	}
	return {
		from,
		to: end,
		insert: next.slice(from, nextEnd),
		suffix: next.slice(nextEnd),
	};
}
