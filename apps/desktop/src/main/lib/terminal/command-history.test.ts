import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { COMMAND_HISTORY_VERSION } from "@superset/shared/command-history";
import {
	getRankedCommandHistory,
	resetCommandHistoryCache,
} from "./command-history";

const TEST_DIR = path.join(
	tmpdir(),
	`superset-command-history-${process.pid}-${Date.now()}`,
);
const TEST_FILE = path.join(TEST_DIR, "command-history.jsonl");

const NOW = 1_800_000_000_000;

function row(command: string, extra: Record<string, unknown> = {}): string {
	return JSON.stringify({
		v: COMMAND_HISTORY_VERSION,
		sessionId: "s",
		command,
		cwd: "/repo",
		exitCode: 0,
		startedAt: NOW,
		durationMs: 5,
		...extra,
	});
}

function write(lines: string[]): void {
	writeFileSync(TEST_FILE, `${lines.join("\n")}\n`);
	resetCommandHistoryCache();
}

function read(options: Parameters<typeof getRankedCommandHistory>[0] = {}) {
	return getRankedCommandHistory({ ...options, filePath: TEST_FILE });
}

beforeEach(() => {
	mkdirSync(TEST_DIR, { recursive: true });
	resetCommandHistoryCache();
});

afterEach(() => {
	rmSync(TEST_DIR, { recursive: true, force: true });
	resetCommandHistoryCache();
});

describe("getRankedCommandHistory", () => {
	it("returns nothing when there is no history file", () => {
		// Every install looks like this until the first command finishes in a
		// shell with integration loaded.
		rmSync(TEST_FILE, { force: true });
		expect(read()).toEqual([]);
	});

	it("ranks what it reads", () => {
		write([row("git status"), row("git status"), row("npm test")]);
		const ranked = read();
		expect(ranked[0]?.command).toBe("git status");
		expect(ranked[0]?.runs).toBe(2);
	});

	it("survives a torn final line", () => {
		// The daemon appends while this reads, so a half-written last line is the
		// normal case. It costs one row, never the file.
		writeFileSync(TEST_FILE, `${row("ls")}\n{"v":1,"command":"tru`);
		resetCommandHistoryCache();
		expect(read()).toHaveLength(1);
	});

	it("notices the file growing without being told", () => {
		write([row("first")]);
		expect(read()).toHaveLength(1);

		// No cache reset — size/mtime invalidation is the thing under test. A
		// cache that missed this would show a history frozen at app launch.
		writeFileSync(TEST_FILE, `${row("first")}\n${row("second")}\n`);
		expect(read()).toHaveLength(2);
	});

	it("filters by query", () => {
		write([row("git status"), row("npm test")]);
		expect(read({ query: "npm" }).map((entry) => entry.command)).toEqual([
			"npm test",
		]);
	});

	it("reads only the tail of a large file, and never a sliced row", () => {
		// The 2MB window will open mid-row. That fragment must be discarded, not
		// parsed into a command nobody ran.
		const filler = "x".repeat(2000);
		const lines = [row("ancient-and-far-away")];
		for (let index = 0; index < 1200; index++) lines.push(row(filler));
		lines.push(row("recent-and-nearby"));
		write(lines);

		const commands = read({ limit: 200 }).map((entry) => entry.command);
		expect(commands).toContain("recent-and-nearby");
		expect(commands).not.toContain("ancient-and-far-away");
		// Only two distinct commands exist in the window; anything else would be
		// a fragment that parsed by accident.
		expect(new Set(commands)).toEqual(new Set([filler, "recent-and-nearby"]));
	});
});
