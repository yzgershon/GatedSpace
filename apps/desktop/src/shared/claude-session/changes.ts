import type {
	SessionChangeSummary,
	SessionFileChange,
} from "../session-changes";
import type { TimelineItem, ToolItem } from "./timeline";

function record(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function lines(value: string) {
	return value
		? value.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n").length
		: 0;
}

/** Read only edit metadata already delivered by Claude; no disk scans. */
export function claudeFileChange(
	item: ToolItem,
	result?: unknown,
): SessionFileChange | undefined {
	if (!["Edit", "MultiEdit", "Write", "NotebookEdit"].includes(item.name))
		return;
	const data = record(result);
	const path =
		data.filePath ?? item.input.file_path ?? item.input.notebook_path;
	if (typeof path !== "string" || !path) return;
	const unknown: SessionFileChange = { path, added: null, removed: null };
	// The provider's patch includes replace_all multiplicity and unchanged lines.
	if (Array.isArray(data.structuredPatch)) {
		let added = 0;
		let removed = 0;
		for (const hunk of data.structuredPatch) {
			const patchLines = record(hunk).lines;
			if (!Array.isArray(patchLines)) return unknown;
			for (const line of patchLines) {
				if (typeof line !== "string") return unknown;
				if (line.startsWith("+")) added++;
				if (line.startsWith("-")) removed++;
			}
		}
		return { path, added, removed };
	}
	if (
		item.name === "Write" &&
		data.type === "create" &&
		typeof item.input.content === "string"
	) {
		return { path, added: lines(item.input.content), removed: 0 };
	}
	// Older transcripts lack structured patches. A single replacement still
	// supplies both sides; writes and replace_all cannot be counted safely.
	if (item.name === "Edit" || item.name === "MultiEdit") {
		const edits = item.name === "MultiEdit" ? item.input.edits : [item.input];
		if (!Array.isArray(edits) || item.input.replace_all) return unknown;
		let added = 0;
		let removed = 0;
		for (const edit of edits) {
			const e = record(edit);
			if (
				e.replace_all ||
				typeof e.old_string !== "string" ||
				typeof e.new_string !== "string"
			)
				return unknown;
			if (e.old_string === e.new_string) continue;
			added += lines(e.new_string);
			removed += lines(e.old_string);
		}
		return { path, added, removed };
	}
	return unknown;
}

export function claudeTaskChanges(
	items: TimelineItem[],
): SessionChangeSummary | null {
	const lastPrompt = items.findLastIndex((item) => item.kind === "user");
	const files = new Set<string>();
	const seen = new Set<string>();
	let added = 0;
	let removed = 0;
	let known = true;
	for (let i = lastPrompt + 1; i < items.length; i++) {
		const item = items[i];
		if (
			item.kind !== "tool" ||
			item.status !== "success" ||
			seen.has(item.toolUseId)
		)
			continue;
		seen.add(item.toolUseId);
		const change = item.fileChange ?? claudeFileChange(item);
		if (!change) continue;
		const path = change.path.replaceAll("\\", "/");
		files.add(/^[a-z]:\//i.test(path) ? path.toLowerCase() : path);
		known &&= change.added !== null && change.removed !== null;
		added += change.added ?? 0;
		removed += change.removed ?? 0;
	}
	return files.size
		? {
				files: files.size,
				added: known ? added : null,
				removed: known ? removed : null,
			}
		: null;
}
