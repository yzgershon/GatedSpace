import type { CodexItem } from "./types";

export interface CodexReviewFile {
	path: string;
	kind: string;
	diffs: string[];
	added: number;
	removed: number;
}
export interface CodexTurnReview {
	id: string;
	turnId: string;
	cwd: string;
	files: CodexReviewFile[];
	added: number;
	removed: number;
	selectedPath?: string;
}

function cleanPath(path: string, stripPrefix = true) {
	let value = path.trim();
	if (value.startsWith('"')) {
		try {
			value = JSON.parse(value);
		} catch {
			/* Keep the provider's literal path. */
		}
	}
	return stripPrefix ? value.replace(/^[ab]\//, "") : value;
}

/** Split only at git file headers, not at hunk markers or text in a patch. */
export function splitTurnDiff(diff: string) {
	return diff
		.replaceAll("\r\n", "\n")
		.split(/(?=^diff --git )/m)
		.flatMap((patch) => {
			if (!patch.trim()) return [];
			const target = /^\+\+\+ (.+)$/m.exec(patch)?.[1];
			const source = /^--- (.+)$/m.exec(patch)?.[1];
			const renamed = /^rename to (.+)$/m.exec(patch)?.[1];
			const header =
				/^diff --git (?:"(?:[^"\\]|\\.)*"|a\/.*?) ("(?:[^"\\]|\\.)*"|b\/.+)$/m.exec(
					patch,
				)?.[1];
			const path =
				renamed ||
				(target && target !== "/dev/null" ? target : source) ||
				header;
			if (!path || path === "/dev/null") return [];
			return [
				{
					path: cleanPath(path, !renamed),
					diff: patch.trimEnd(),
					kind:
						target === "/dev/null"
							? "delete"
							: source === "/dev/null"
								? "add"
								: renamed
									? "rename"
									: "update",
				},
			];
		});
}

export function buildTurnReview({
	id,
	turnId,
	cwd,
	items,
	diff,
}: {
	id: string;
	turnId: string;
	cwd: string;
	items: CodexItem[];
	diff?: string;
}): CodexTurnReview | null {
	const net = diff ? splitTurnDiff(diff) : [];
	const changes = net.length
		? net
		: items
				.filter(
					(item) =>
						!["failed", "declined", "inProgress"].includes(item.status ?? ""),
				)
				.flatMap((item) => item.changes ?? []);
	const files = new Map<string, CodexReviewFile>();
	for (const change of changes) {
		if (!change.path) continue;
		const key = change.path.replaceAll("\\", "/");
		let file = files.get(key);
		if (!file) {
			file = {
				path: change.path,
				kind: change.kind,
				diffs: [],
				added: 0,
				removed: 0,
			};
			files.set(key, file);
		}
		if (change.diff) file.diffs.push(change.diff);
		let inHunk = false;
		for (const line of change.diff.split("\n")) {
			if (line.startsWith("@@ ")) inHunk = true;
			if (line.startsWith("diff --git ")) inHunk = false;
			if (line.startsWith("+") && (inHunk || !line.startsWith("+++")))
				file.added++;
			if (line.startsWith("-") && (inHunk || !line.startsWith("---")))
				file.removed++;
		}
	}
	if (!files.size) return null;
	const result = [...files.values()];
	return {
		id,
		turnId,
		cwd,
		files: result,
		added: result.reduce((n, f) => n + f.added, 0),
		removed: result.reduce((n, f) => n + f.removed, 0),
	};
}
