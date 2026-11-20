import { describe, expect, test } from "bun:test";
import {
	groupSubagents,
	type TimelineItem,
} from "shared/claude-session/timeline";
import {
	historyPageStart,
	TRANSCRIPT_PAGE_SIZE,
	visibleTranscriptItems,
} from "./transcript-window";

function conversation(turns: number): TimelineItem[] {
	return Array.from({ length: turns }, (_, index): TimelineItem[] => [
		{ kind: "user", id: `user-${index}`, text: `Question ${index}` },
		{
			kind: "text",
			id: `text-${index}`,
			text: `Answer ${index}`,
			parentToolUseId: null,
		},
	]).flat();
}

describe("Claude display history", () => {
	test("short and empty conversations stay complete", () => {
		for (const items of [[], conversation(8)]) {
			expect(historyPageStart(items)).toBe(0);
			expect(visibleTranscriptItems(items, 0)).toBe(items);
		}
	});
	test("only the recent page is displayed; loading every page restores exact history", () => {
		const items = conversation(1000);
		const original = JSON.stringify(items);
		let start = historyPageStart(items);
		expect(start).toBe(items.length - TRANSCRIPT_PAGE_SIZE);
		expect(visibleTranscriptItems(items, start).at(-1)).toBe(items.at(-1));
		while (start > 0) {
			const next = historyPageStart(items, start);
			expect(next).toBeLessThan(start);
			start = next;
		}
		expect(visibleTranscriptItems(items, start)).toBe(items);
		expect(JSON.stringify(items)).toBe(original);
	});
	test("a single very long turn stays bounded but keeps its original prompt", () => {
		const items: TimelineItem[] = [
			{
				kind: "user",
				id: "prompt",
				text: "Original task",
				attachments: [
					{
						name: "reference.png",
						mediaType: "image/png",
						thumbnail: "fixture",
					},
				],
			},
			...Array.from(
				{ length: 1000 },
				(_, index): TimelineItem => ({
					kind: "tool",
					id: `tool-${index}`,
					toolUseId: `use-${index}`,
					name: "Read",
					input: { file_path: `file-${index}.ts` },
					output: "Saved output",
					status: "success",
					parentToolUseId: null,
				}),
			),
		];
		const page = visibleTranscriptItems(items, historyPageStart(items));
		expect(page).toHaveLength(TRANSCRIPT_PAGE_SIZE + 1);
		expect(page[0]).toBe(items[0]);
		expect(page.at(-1)).toBe(items.at(-1));
		expect(items).toHaveLength(1001);
	});
	test("a nearby prompt is included without cutting its answer", () => {
		const items = conversation(51);
		items.push({ kind: "notice", id: "notice", text: "Finished" });
		const start = historyPageStart(items);
		expect(items[start]?.kind).toBe("user");
		expect(items.length - start).toBeLessThanOrEqual(TRANSCRIPT_PAGE_SIZE + 20);
	});
	test("subagent children remain attached to their task across history pages", () => {
		const items = conversation(60);
		const task: TimelineItem = {
			kind: "tool",
			id: "task",
			toolUseId: "task-use",
			name: "Task",
			input: {},
			status: "success",
			parentToolUseId: null,
		};
		const child: TimelineItem = {
			kind: "text",
			id: "child",
			text: "Review",
			parentToolUseId: "task-use",
		};
		items.push(task, child);
		const grouped = groupSubagents(items);
		const visible = visibleTranscriptItems(
			grouped.topLevel,
			historyPageStart(grouped.topLevel),
		);
		expect(visible).toContain(task);
		expect(visible).not.toContain(child);
		expect(grouped.groups.get("task-use")).toEqual([child]);
		expect(items.at(-1)).toBe(child);
	});
	test("resumed leading output and updated streaming rows keep their data", () => {
		const items = conversation(100).filter((item) => item.kind !== "user");
		const last = items.at(-1);
		expect(visibleTranscriptItems(items, historyPageStart(items))).toHaveLength(
			TRANSCRIPT_PAGE_SIZE,
		);
		const updated = items.map((item) =>
			item === last && item.kind === "text"
				? { ...item, text: "Still streaming..." }
				: item,
		);
		expect(
			visibleTranscriptItems(updated, historyPageStart(updated)).at(-1),
		).toBe(updated.at(-1));
		expect(items.at(-1)).toBe(last);
	});
});
