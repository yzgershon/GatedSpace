import { describe, expect, test } from "bun:test";
import { resolvePaneRename } from "./resolve-rename";

describe("resolvePaneRename", () => {
	test("a new name is committed, trimmed", () => {
		expect(resolvePaneRename("  build watcher  ", "zsh")).toEqual({
			shouldRename: true,
			title: "build watcher",
		});
	});

	test("clearing restores the derived title rather than blanking the pane", () => {
		// Without this there is no way back: a pane named "" stays "" forever,
		// and four of them are indistinguishable.
		expect(resolvePaneRename("   ", "zsh")).toEqual({
			shouldRename: true,
			title: undefined,
		});
	});

	test("committing the displayed name does nothing", () => {
		// Otherwise opening the editor and pressing Enter would PIN the pane to a
		// name that merely happens to match the derived one right now, and it
		// would stop tracking whatever it goes on to run.
		expect(resolvePaneRename("zsh", "zsh")).toEqual({ shouldRename: false });
		expect(resolvePaneRename("  zsh  ", "zsh")).toEqual({
			shouldRename: false,
		});
	});

	test("a name that differs only from an already-overridden one still commits", () => {
		expect(resolvePaneRename("tests", "build watcher")).toEqual({
			shouldRename: true,
			title: "tests",
		});
	});
});
