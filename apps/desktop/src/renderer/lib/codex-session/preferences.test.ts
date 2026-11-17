import { expect, test } from "bun:test";
import { CodexPreferenceStore } from "./preferences";

function storage() {
	const values = new Map<string, string>();
	return {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => {
			values.set(key, value);
		},
	};
}

test("effort, model and Fast survive a restart and reopening in a new pane", () => {
	const disk = storage();
	const first = new CodexPreferenceStore(() => disk);
	first.bind("pane-a", "conversation");
	first.update("pane-a", {
		model: "selected-model",
		effort: "high",
		fast: true,
	});
	const restarted = new CodexPreferenceStore(() => disk);
	expect(restarted.get("pane-a")).toEqual({
		model: "selected-model",
		effort: "high",
		fast: true,
	});
	expect(restarted.bind("pane-b", "conversation")).toEqual(
		restarted.get("pane-a"),
	);
	expect(restarted.get("unrelated")).toEqual({});
});

test("explicit Fast off persists, while partial updates do not clear it", () => {
	const disk = storage();
	const first = new CodexPreferenceStore(() => disk);
	first.bind("pane", "thread");
	first.update("pane", { fast: true, effort: "medium" });
	first.update("pane", { fast: false });
	first.update("pane", { model: "another", fast: undefined });
	const next = new CodexPreferenceStore(() => disk);
	expect(next.bind("new-pane", "thread")).toEqual({
		fast: false,
		effort: "medium",
		model: "another",
	});
});

test("choice during startup wins, then repeated bindings cannot reset it", () => {
	const disk = storage();
	const saved = new CodexPreferenceStore(() => disk);
	saved.bind("old", "thread");
	saved.update("old", { effort: "low", fast: false });
	const current = new CodexPreferenceStore(() => disk);
	current.update("new", { effort: "high", fast: true });
	expect(current.bind("new", "thread")).toEqual({ effort: "high", fast: true });
	expect(current.bind("new", "thread")).toEqual({ effort: "high", fast: true });
});

test("reusing a pane restores that conversation's choices without account dependence", () => {
	const disk = storage();
	const store = new CodexPreferenceStore(() => disk);
	store.bind("first", "one");
	store.update("first", { fast: true, effort: "high" });
	store.bind("second", "two");
	store.update("second", { fast: false, effort: "low" });
	expect(store.bind("first", "two")).toEqual({ fast: false, effort: "low" });
	expect(store.bind("first", "one")).toEqual({ fast: true, effort: "high" });
});

test("malformed or unavailable storage leaves in-memory choices usable", () => {
	const disk = storage();
	disk.setItem(
		"codex-preferences:pane:bad",
		'{"effort":17,"fast":"false","text":"not a preference"}',
	);
	expect(new CodexPreferenceStore(() => disk).get("bad")).toEqual({});
	const blocked = new CodexPreferenceStore(() => {
		throw new Error("Storage unavailable");
	});
	blocked.update("pane", { fast: true });
	expect(blocked.bind("pane", "thread")).toEqual({ fast: true });
});
