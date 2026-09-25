import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
import {
	GIT_DIR_DEBOUNCE_MS,
	type GitChangedEvent,
	GitWatcher,
	isStatusRelevantGitDirEvent,
} from "./git-watcher";

/**
 * The dispatch seam the `.git/` watcher callback feeds into. Driving it
 * directly lets us assert emit/debounce behavior without spinning a real
 * `fs.watch` over a scratch repo.
 */
interface GitWatcherInternals {
	handleGitDirEvent(workspaceId: string, filename: string | null): void;
}

function createWatcher(): GitWatcher {
	// `start()` is never called, so the dispatch methods under test never touch
	// the db — an empty stand-in is enough.
	return new GitWatcher(
		{} as unknown as ConstructorParameters<typeof GitWatcher>[0],
	);
}

function internals(watcher: GitWatcher): GitWatcherInternals {
	return watcher as unknown as GitWatcherInternals;
}

describe("isStatusRelevantGitDirEvent", () => {
	test("ignores `.git/` paths whose churn can't change `git status`", () => {
		const ignored = [
			"objects",
			"objects/ab/cdef0123456789",
			"objects/pack/pack-abc.pack",
			"objects/pack/pack-abc.idx",
			"lfs",
			"lfs/objects/aa/bb/ccdd",
			"logs",
			"logs/HEAD",
			"logs/refs/heads/main",
			"FETCH_HEAD",
		];
		for (const path of ignored) {
			expect(isStatusRelevantGitDirEvent(path)).toBe(false);
		}
	});

	test("keeps status-relevant `.git/` paths", () => {
		const relevant = [
			"HEAD",
			"index",
			"refs/heads/main",
			"refs/remotes/origin/main",
			"packed-refs",
			"MERGE_HEAD",
			"ORIG_HEAD",
			"config",
		];
		for (const path of relevant) {
			expect(isStatusRelevantGitDirEvent(path)).toBe(true);
		}
	});

	test("fails open when the watcher can't say what changed", () => {
		expect(isStatusRelevantGitDirEvent(null)).toBe(true);
		expect(isStatusRelevantGitDirEvent(undefined)).toBe(true);
		expect(isStatusRelevantGitDirEvent("")).toBe(true);
	});

	test("does not confuse a top-level file that merely starts with an ignored name", () => {
		expect(isStatusRelevantGitDirEvent("objects-are-cool")).toBe(true);
		expect(isStatusRelevantGitDirEvent("logspam")).toBe(true);
	});
});

describe("GitWatcher .git event filtering", () => {
	beforeEach(() => {
		jest.useFakeTimers();
	});
	afterEach(() => {
		jest.useRealTimers();
	});

	test("ignored `.git/` events never emit, even past the window", () => {
		const watcher = createWatcher();
		const events: GitChangedEvent[] = [];
		watcher.onChanged((event) => events.push(event));

		for (const path of [
			"objects/ab/cdef",
			"objects/pack/pack-x.pack",
			"lfs/objects/aa/bb",
			"logs/HEAD",
			"FETCH_HEAD",
		]) {
			internals(watcher).handleGitDirEvent("workspace-1", path);
		}

		jest.advanceTimersByTime(GIT_DIR_DEBOUNCE_MS * 2);
		expect(events).toEqual([]);
	});

	test("status-relevant `.git/` events emit a change signal", () => {
		const watcher = createWatcher();
		const events: GitChangedEvent[] = [];
		watcher.onChanged((event) => events.push(event));

		internals(watcher).handleGitDirEvent("workspace-1", "index");
		jest.advanceTimersByTime(GIT_DIR_DEBOUNCE_MS);

		expect(events).toEqual([{ workspaceId: "workspace-1" }]);
	});
});

describe("GitWatcher debounce", () => {
	beforeEach(() => {
		jest.useFakeTimers();
	});
	afterEach(() => {
		jest.useRealTimers();
	});

	test("a `.git/` batch waits the full window", () => {
		const watcher = createWatcher();
		const events: GitChangedEvent[] = [];
		watcher.onChanged((event) => events.push(event));

		internals(watcher).handleGitDirEvent("workspace-1", "index");

		jest.advanceTimersByTime(GIT_DIR_DEBOUNCE_MS - 1);
		expect(events).toEqual([]);

		jest.advanceTimersByTime(1);
		expect(events).toEqual([{ workspaceId: "workspace-1" }]);
	});

	test("rapid `.git/` events ride the first window instead of resetting it", () => {
		const watcher = createWatcher();
		const events: GitChangedEvent[] = [];
		watcher.onChanged((event) => events.push(event));

		// First `.git/` event arms the window at t=0.
		internals(watcher).handleGitDirEvent("workspace-1", "index");
		jest.advanceTimersByTime(GIT_DIR_DEBOUNCE_MS - 100);

		// A later event must NOT push the flush out, or a rapid metadata
		// sequence (rebase, `git am`) would keep resetting the clock.
		internals(watcher).handleGitDirEvent("workspace-1", "HEAD");
		expect(events).toEqual([]);

		// The window armed by the first event still elapses on schedule, once.
		jest.advanceTimersByTime(100);
		expect(events).toEqual([{ workspaceId: "workspace-1" }]);
		jest.advanceTimersByTime(GIT_DIR_DEBOUNCE_MS);
		expect(events).toEqual([{ workspaceId: "workspace-1" }]);
	});

	test("workspaces debounce independently", () => {
		const watcher = createWatcher();
		const events: GitChangedEvent[] = [];
		watcher.onChanged((event) => events.push(event));

		internals(watcher).handleGitDirEvent("workspace-1", "index");
		internals(watcher).handleGitDirEvent("workspace-2", "HEAD");
		jest.advanceTimersByTime(GIT_DIR_DEBOUNCE_MS);

		expect(events).toEqual([
			{ workspaceId: "workspace-1" },
			{ workspaceId: "workspace-2" },
		]);
	});
});
