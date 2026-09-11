/**
 * Folding a run of bodyless tool calls into one summary line.
 *
 * A separate module from the component, and not only for tidiness:
 * `SessionTimelineView.tsx` reaches `useSkinTokens` -> preferences ->
 * collections -> the electron tRPC client, which has no global outside a
 * renderer, so importing it from a test errors at module load. Anything here
 * is pure and importable, which is what makes it testable at all.
 */
import type { TimelineItem, ToolItem } from "shared/claude-session/timeline";

/**
 * Tools whose whole story is their header line.
 *
 * A run of these is what the reference folds into one `◆` summary. The test is
 * NOT "did it succeed" — a Bash that printed nothing still had output worth a
 * row, and an Edit always carries a diff. It is "does this call have a body",
 * and for these it never does: a Read renders its name and path, a Grep renders
 * a match count, and that is all there is.
 */
export const FOLDABLE_TOOLS = new Set([
	"Read",
	"TodoWrite",
	"Glob",
	"Grep",
	"WebSearch",
	"WebFetch",
	"NotebookRead",
]);

/**
 * How each tool counts itself: past-tense verb plus the thing it acted on.
 *
 * Written per tool rather than derived from the name, because "Glob" and "Grep"
 * are both "Searched" and neither word appears in the tool's own name.
 */
const FOLD_LABELS: Record<string, { verb: string; noun: string }> = {
	Read: { verb: "Read", noun: "file" },
	TodoWrite: { verb: "Updated", noun: "todo list" },
	Glob: { verb: "Searched", noun: "pattern" },
	Grep: { verb: "Searched", noun: "pattern" },
	WebSearch: { verb: "Searched", noun: "website" },
	WebFetch: { verb: "Fetched", noun: "page" },
	NotebookRead: { verb: "Read", noun: "notebook" },
};

/** "Read 4 files, Searched 2 patterns" — counted in first-seen order. */
export function foldSummary(items: ToolItem[]): string {
	const counts: { key: string; n: number }[] = [];
	for (const item of items) {
		const found = counts.find((c) => c.key === item.name);
		if (found) found.n += 1;
		else counts.push({ key: item.name, n: 1 });
	}
	return counts
		.map(({ key, n }) => {
			const label = FOLD_LABELS[key];
			if (!label) return `${key} ×${n}`;
			// "Updated todo list" reads wrong pluralised, and counting it is noise:
			// the list is one thing however many times it was rewritten.
			if (key === "TodoWrite") return `${label.verb} ${label.noun}`;
			return `${label.verb} ${n} ${label.noun}${n === 1 ? "" : "s"}`;
		})
		.join(", ");
}

/** One rendered entry: either a single item, or a folded run of tool calls. */
export type TimelineEntry =
	| { kind: "item"; item: TimelineItem }
	| { kind: "fold"; id: string; items: ToolItem[] };

/**
 * Collapse consecutive bodyless tool calls into one entry.
 *
 * Three rules, and each of them is a case that looked wrong when it was
 * missing:
 *
 *  - A run of ONE never folds. Hiding a single Read behind "1 step" costs a
 *    click and saves nothing.
 *  - A tool that is still RUNNING never folds. Folding summarises what
 *    happened, and the live dot pulsing on its own row is how you can tell the
 *    agent has not stalled.
 *  - A tool with subagent children never folds, because the children are the
 *    body it is being folded for not having.
 */
export function foldRuns(
	items: TimelineItem[],
	enabled: boolean,
	groups?: Map<string, TimelineItem[]>,
	drafts?: ReadonlySet<string>,
): TimelineEntry[] {
	if (!enabled) return items.map((item) => ({ kind: "item" as const, item }));

	const foldable = (item: TimelineItem): item is ToolItem =>
		item.kind === "tool" &&
		item.status !== "running" &&
		FOLDABLE_TOOLS.has(item.name) &&
		!drafts?.has(item.id) &&
		!groups?.get(item.toolUseId)?.length;

	const out: TimelineEntry[] = [];
	let run: ToolItem[] = [];
	const flush = () => {
		if (run.length > 1) {
			// Keyed on the first call's id: stable across re-renders, and unique
			// because no two tool calls share one.
			out.push({ kind: "fold", id: `fold:${run[0]?.id}`, items: run });
		} else {
			for (const item of run) out.push({ kind: "item", item });
		}
		run = [];
	};
	for (const item of items) {
		if (foldable(item)) run.push(item);
		else {
			flush();
			out.push({ kind: "item", item });
		}
	}
	flush();
	return out;
}
