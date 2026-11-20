import { expect, test } from "bun:test";
import { createFirstRunStore } from "./state";

function storage() {
	const values = new Map<string, string>();
	return {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => {
			values.set(key, value);
		},
		removeItem: (key: string) => {
			values.delete(key);
		},
	};
}
test("new PC gets setup while existing work is never interrupted", () => {
	const fresh = createFirstRunStore(storage());
	fresh.getState().inspect(false);
	expect(fresh.getState().step).toBe("account");
	expect(fresh.getState().open).toBe(true);
	const existing = createFirstRunStore(storage());
	existing.getState().inspect(true);
	expect(existing.getState().step).toBe("complete");
	expect(existing.getState().open).toBe(false);
});
test("restart resumes the last real workspace instead of creating a second one", () => {
	const disk = storage();
	const first = createFirstRunStore(disk);
	first.getState().inspect(false);
	first.getState().chooseAgent("claude");
	first.getState().workspaceReady("workspace-id", "C:/Project");
	const restarted = createFirstRunStore(disk);
	restarted.getState().inspect(true);
	expect(restarted.getState().step).toBe("launch");
	expect(restarted.getState().workspaceId).toBe("workspace-id");
	expect(restarted.getState().agent).toBe("claude");
});
test("deferral preserves progress, completion survives restart, menu can replay", () => {
	const disk = storage();
	const first = createFirstRunStore(disk);
	first.getState().inspect(false);
	first.getState().go("agents");
	first.getState().defer();
	const next = createFirstRunStore(disk);
	expect(next.getState().step).toBe("agents");
	expect(next.getState().open).toBe(false);
	next.getState().resume();
	expect(next.getState().step).toBe("agents");
	next.getState().finish();
	const finished = createFirstRunStore(disk);
	finished.getState().inspect(false);
	expect(finished.getState().step).toBe("complete");
	finished.getState().resume();
	expect(finished.getState().step).toBe("account");
});
