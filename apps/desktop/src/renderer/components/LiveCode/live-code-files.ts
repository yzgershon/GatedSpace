import { claudeFileChange } from "shared/claude-session/changes";
import type { TimelineItem } from "shared/claude-session/timeline";
import { splitTurnDiff } from "shared/codex-session/review";
import type { CodexSessionState } from "shared/codex-session/types";

export interface LiveCodeFile {
	path: string;
	revision: string;
	deleted?: boolean;
	patch?: string;
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
			const key = codePathKey(state.cwd ?? "", change.path);
			paths.delete(key);
			paths.set(key, {
				path: change.path,
				revision: `${item.id}:${item.status}:${change.diff}`,
				deleted: change.kind === "delete",
				patch: change.diff,
			});
		}
	}
	for (const file of splitTurnDiff(
		state.turns?.find((turn) => turn.id === turnId)?.diff ?? "",
	)) {
		const key = codePathKey(state.cwd ?? "", file.path);
		const existing = paths.get(key);
		if (existing) {
			// The aggregate diff describes the same file with a different path form.
			paths.set(key, { ...existing, patch: file.diff });
		} else
			paths.set(key, {
				path: file.path,
				revision: file.diff,
				deleted: file.kind === "delete",
				patch: file.diff,
			});
	}
	return [...paths.values()];
}

export function claudeLiveFiles(
	items: TimelineItem[],
	cwd = "",
): LiveCodeFile[] {
	const paths = new Map<string, LiveCodeFile>();
	for (const item of items.slice(
		items.findLastIndex((item) => item.kind === "user") + 1,
	)) {
		if (item.kind !== "tool" || item.status === "error") continue;
		const change = item.fileChange ?? claudeFileChange(item);
		if (!change) continue;
		const key = codePathKey(cwd, change.path);
		paths.delete(key);
		const edits =
			item.name === "MultiEdit" && Array.isArray(item.input.edits)
				? item.input.edits
				: [item.input];
		const patch = edits
			.flatMap((edit) => {
				if (!edit || typeof edit !== "object") return [];
				const value = edit as Record<string, unknown>;
				if (
					typeof value.old_string !== "string" ||
					typeof value.new_string !== "string"
				)
					return [];
				// Claude's Edit input is an excerpt, not a file with known line offsets.
				return [
					snapshotPatch(value.old_string, value.new_string).replace(
						/^@@.*@@/,
						"@@ Edited excerpt @@",
					),
				];
			})
			.join("\n");
		paths.set(key, {
			path: change.path,
			revision: `${item.toolUseId}:${item.status}:${JSON.stringify(item.input)}`,
			patch: patch || undefined,
		});
	}
	return [...paths.values()];
}

export function absoluteCodePath(cwd: string, path: string) {
	const slashes = path.replaceAll("\\", "/");
	const normalized = /^[a-z]:[\\/]/i.test(cwd)
		? slashes.replace(/^\/([a-z])\//i, "$1:/")
		: slashes;
	const absolute = /^(?:[a-z]:\/|\/)/i.test(normalized)
		? normalized
		: `${cwd.replaceAll("\\", "/").replace(/\/$/, "")}/${normalized}`;
	const prefix = absolute.startsWith("//")
		? "//"
		: absolute.startsWith("/")
			? "/"
			: "";
	const parts: string[] = [];
	for (const part of absolute.slice(prefix.length).split("/")) {
		if (!part || part === ".") continue;
		if (part === ".." && parts.length && !parts.at(-1)?.endsWith(":"))
			parts.pop();
		else if (part !== "..") parts.push(part);
	}
	return prefix + parts.join("/");
}

export function codePathKey(cwd: string, path: string) {
	const absolute = absoluteCodePath(cwd, path);
	return /^(?:[a-z]:\/|\/\/)/i.test(absolute)
		? absolute.toLowerCase()
		: absolute;
}

/** A truthful compact comparison of two observed snapshots (not a Git baseline). */
export function snapshotPatch(before: string, after: string) {
	if (before === after) return "";
	const old = before.replaceAll("\r\n", "\n").split("\n");
	const next = after.replaceAll("\r\n", "\n").split("\n");
	let from = 0,
		oldEnd = old.length,
		newEnd = next.length;
	while (from < oldEnd && from < newEnd && old[from] === next[from]) from++;
	while (
		oldEnd > from &&
		newEnd > from &&
		old[oldEnd - 1] === next[newEnd - 1]
	) {
		oldEnd--;
		newEnd--;
	}
	const start = Math.max(0, from - 3),
		context = Math.min(3, old.length - oldEnd);
	return [
		`@@ -${start + 1},${oldEnd - start + context} +${start + 1},${newEnd - start + context} @@`,
		...old.slice(start, from).map((line) => ` ${line}`),
		...old.slice(from, oldEnd).map((line) => `-${line}`),
		...next.slice(from, newEnd).map((line) => `+${line}`),
		...next.slice(newEnd, newEnd + context).map((line) => ` ${line}`),
	].join("\n");
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
