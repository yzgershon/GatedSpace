import { describe, expect, test } from "bun:test";
import {
	COMMAND_HISTORY_VERSION,
	type CommandHistoryRow,
	isSuccessExit,
	parseCommandHistory,
	parseCommandHistoryLine,
	rankCommands,
} from "./command-history";

const DAY = 86_400_000;
const NOW = 1_800_000_000_000;

function row(
	command: string,
	daysAgo: number,
	extra: Partial<CommandHistoryRow> = {},
): CommandHistoryRow {
	return {
		v: COMMAND_HISTORY_VERSION,
		sessionId: "s",
		command,
		cwd: "/repo",
		exitCode: 0,
		startedAt: NOW - daysAgo * DAY,
		durationMs: 10,
		...extra,
	};
}

describe("isSuccessExit", () => {
	test("interrupt exits count as success", () => {
		// 130 is Ctrl-C, 143 is SIGTERM. Both are how a long-running process is
		// normally ENDED, not how it fails. Counting them as failures would
		// demote `npm run dev` precisely because it gets used constantly.
		expect(isSuccessExit(0)).toBe(true);
		expect(isSuccessExit(130)).toBe(true);
		expect(isSuccessExit(143)).toBe(true);
	});

	test("real failures are still failures", () => {
		expect(isSuccessExit(1)).toBe(false);
		expect(isSuccessExit(127)).toBe(false);
	});
});

describe("parseCommandHistoryLine", () => {
	test("reads a well-formed row", () => {
		const line = JSON.stringify(row("git status", 0));
		expect(parseCommandHistoryLine(line)?.command).toBe("git status");
	});

	test("a torn final line costs one row, not the file", () => {
		// The writer appends while a reader reads, so a half-written last line is
		// expected rather than exceptional.
		const good = JSON.stringify(row("ls", 0));
		const contents = `${good}\n{"v":1,"command":"tru`;
		expect(parseCommandHistory(contents)).toHaveLength(1);
	});

	test("rows from a future version are skipped, not guessed at", () => {
		const future = JSON.stringify({ ...row("ls", 0), v: 99 });
		expect(parseCommandHistoryLine(future)).toBeNull();
	});

	test("rows missing required fields are skipped", () => {
		expect(parseCommandHistoryLine('{"v":1,"command":""}')).toBeNull();
		expect(parseCommandHistoryLine('{"v":1,"exitCode":0}')).toBeNull();
		expect(parseCommandHistoryLine("not json")).toBeNull();
		expect(parseCommandHistoryLine("")).toBeNull();
	});
});

describe("rankCommands", () => {
	test("a daily habit outranks one afternoon's flailing", () => {
		// The whole reason repetition is counted in distinct days: 40 runs of one
		// command while debugging is not a habit, and raw counts would rank it
		// above something genuinely used every day.
		const rows = [
			...Array.from({ length: 40 }, () => row("npm run flail", 1)),
			...Array.from({ length: 10 }, (_, i) => row("git status", i)),
		];
		const [top] = rankCommands(rows, { now: NOW });
		expect(top?.command).toBe("git status");
	});

	test("recent use beats old use at equal frequency", () => {
		const rows = [
			...Array.from({ length: 5 }, (_, i) => row("recent", i)),
			...Array.from({ length: 5 }, (_, i) => row("ancient", 60 + i)),
		];
		const [top] = rankCommands(rows, { now: NOW });
		expect(top?.command).toBe("recent");
	});

	test("commands used in this directory are preferred", () => {
		const rows = [
			row("here", 1, { cwd: "/repo" }),
			row("here", 2, { cwd: "/repo" }),
			row("elsewhere", 1, { cwd: "/other" }),
			row("elsewhere", 2, { cwd: "/other" }),
		];
		const [top] = rankCommands(rows, { now: NOW, cwd: "/repo" });
		expect(top?.command).toBe("here");
	});

	test("a failing command ranks below an equivalent success but is KEPT", () => {
		// Re-running something that just failed is one of the commonest reasons
		// to reach for history, so hiding failures would defeat the point.
		const rows = [
			row("passes", 1),
			row("passes", 2),
			row("fails", 1, { exitCode: 1 }),
			row("fails", 2, { exitCode: 1 }),
		];
		const ranked = rankCommands(rows, { now: NOW });
		expect(ranked.map((r) => r.command)).toEqual(["passes", "fails"]);
	});

	test("a command ended with Ctrl-C is not treated as failed", () => {
		const ranked = rankCommands([row("npm run dev", 1, { exitCode: 130 })], {
			now: NOW,
		});
		expect(ranked[0]?.lastSucceeded).toBe(true);
	});

	test("the query filters case-insensitively", () => {
		const rows = [row("git status", 1), row("npm run build", 1)];
		const ranked = rankCommands(rows, { now: NOW, query: "GIT" });
		expect(ranked.map((r) => r.command)).toEqual(["git status"]);
	});

	test("identical commands collapse into one entry with counts", () => {
		const rows = [row("ls", 0), row("ls", 1), row("ls", 1)];
		const ranked = rankCommands(rows, { now: NOW });
		expect(ranked).toHaveLength(1);
		expect(ranked[0]).toMatchObject({ runs: 3, days: 2 });
	});

	test("the most recent run decides the success flag, whatever the file order", () => {
		// A resumed session can append out of order, so the newest row wins by
		// timestamp rather than by position.
		const rows = [row("flaky", 0), row("flaky", 5, { exitCode: 1 })];
		expect(rankCommands(rows, { now: NOW })[0]?.lastSucceeded).toBe(true);
	});

	test("the limit is respected", () => {
		const rows = Array.from({ length: 30 }, (_, i) => row(`cmd${i}`, 1));
		expect(rankCommands(rows, { now: NOW, limit: 5 })).toHaveLength(5);
	});

	test("an empty history ranks to nothing rather than throwing", () => {
		expect(rankCommands([], { now: NOW })).toEqual([]);
	});
});
