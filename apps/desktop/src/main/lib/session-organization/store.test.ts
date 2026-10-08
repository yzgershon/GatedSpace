import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type OrganizedSession,
	orderedPins,
	projectForSession,
	sessionKey,
} from "shared/session-organization";
import { SessionOrganizationStore } from "./store";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0))
		rmSync(dir, { recursive: true, force: true });
});
function setup() {
	const dir = mkdtempSync(join(tmpdir(), "gatedspace-projects-"));
	dirs.push(dir);
	const file = join(dir, "projects.json");
	return { file, store: new SessionOrganizationStore(file) };
}
const session = (
	provider: "claude" | "codex" = "codex",
	lastModified = 1,
): OrganizedSession => ({
	provider,
	sessionId: crypto.randomUUID(),
	title: "Keep my chosen name",
	cwd: "C:/Dev/superset",
	lastModified,
});

test("creating, assigning, renaming, collapsing and reordering projects survive a new process", () => {
	const { store, file } = setup();
	const a = session();
	const b = session("claude");
	const first = store.apply({
		type: "createProject",
		name: " Work ",
		session: a,
	}).projects[0];
	const second = store.apply({ type: "createProject", name: "School" })
		.projects[1];
	store.apply({ type: "assign", session: b, projectId: first.id });
	store.apply({ type: "renameProject", id: first.id, name: "Development" });
	store.apply({ type: "collapse", id: first.id, collapsed: true });
	store.apply({
		type: "moveProject",
		id: second.id,
		target: first.id,
		after: false,
	});
	const restored = new SessionOrganizationStore(file).read();
	expect(restored.projects.map((p) => p.name)).toEqual([
		"School",
		"Development",
	]);
	expect(restored.projects[1].sessions).toEqual([sessionKey(a), sessionKey(b)]);
	expect(restored.bookmarks[sessionKey(a)]).toEqual(a);
	expect(restored.collapsed).toContain(first.id);
});
test("same native id in Claude and Codex has independent membership", () => {
	const { store } = setup();
	const a = session();
	const b = { ...a, provider: "claude" as const };
	const one = store.apply({ type: "createProject", name: "One", session: a })
		.projects[0];
	const two = store.apply({ type: "createProject", name: "Two", session: b })
		.projects[1];
	expect(projectForSession(store.read(), sessionKey(a))?.id).toBe(one.id);
	expect(projectForSession(store.read(), sessionKey(b))?.id).toBe(two.id);
});
test("moving between projects is exclusive and does not rewrite title or cwd", () => {
	const { store } = setup();
	const a = session();
	const one = store.apply({ type: "createProject", name: "One", session: a })
		.projects[0];
	const two = store.apply({ type: "createProject", name: "Two" }).projects[1];
	store.apply({ type: "assign", session: a, projectId: two.id });
	expect(store.read().projects.find((p) => p.id === one.id)?.sessions).toEqual(
		[],
	);
	expect(projectForSession(store.read(), sessionKey(a))?.id).toBe(two.id);
	expect(store.read().bookmarks[sessionKey(a)]).toEqual(a);
});
test("removing a project preserves old session bookmarks for Unsorted, including after restart", () => {
	const { store, file } = setup();
	const a = session();
	const project = store.apply({
		type: "createProject",
		name: "Archive research",
		session: a,
	}).projects[0];
	store.apply({ type: "removeProject", id: project.id });
	const state = new SessionOrganizationStore(file).read();
	expect(projectForSession(state, sessionKey(a))).toBeUndefined();
	expect(state.bookmarks[sessionKey(a)]).toEqual(a);
});
test("Unsorted retains bookmarks even when the session is older than the recent query", () => {
	const { store } = setup();
	const a = session();
	store.apply({ type: "assign", session: a, projectId: null });
	expect(store.read().bookmarks[sessionKey(a)]).toEqual(a);
});
test("duplicate or blank project names fail without changing the saved file", () => {
	const { store, file } = setup();
	store.apply({ type: "createProject", name: "Work" });
	const before = readFileSync(file, "utf8");
	expect(() => store.apply({ type: "createProject", name: " work " })).toThrow(
		"already exists",
	);
	expect(() => store.apply({ type: "createProject", name: " " })).toThrow();
	expect(readFileSync(file, "utf8")).toBe(before);
});
test("corrupt metadata fails closed and is never overwritten", () => {
	const { store, file } = setup();
	writeFileSync(file, "damaged bytes");
	expect(() => store.apply({ type: "createProject", name: "Work" })).toThrow(
		"preserved",
	);
	expect(readFileSync(file, "utf8")).toBe("damaged bytes");
});
test("reordering mixed-provider pins preserves hidden pins and survives changed activity", () => {
	const { store, file } = setup();
	const a = session("codex", 30);
	const hidden = session("claude", 20);
	const b = session("codex", 10);
	store.apply(
		{
			type: "movePin",
			key: sessionKey(b),
			target: sessionKey(a),
			after: false,
		},
		[a, hidden, b],
	);
	const restored = new SessionOrganizationStore(file).read();
	expect(restored.pinnedOrder).toEqual([
		sessionKey(b),
		sessionKey(a),
		sessionKey(hidden),
	]);
	expect(
		orderedPins(
			[
				{ ...a, lastModified: 100, pinned: true },
				{ ...hidden, pinned: true },
				{ ...b, pinned: true },
			],
			restored.pinnedOrder,
		).map(sessionKey),
	).toEqual(restored.pinnedOrder);
});
test("stale reorder cannot silently lose pins", () => {
	const { store } = setup();
	const a = session();
	const b = session();
	expect(() =>
		store.apply(
			{
				type: "movePin",
				key: sessionKey(a),
				target: sessionKey(b),
				after: false,
			},
			[a],
		),
	).toThrow("no longer pinned");
	expect(store.read().pinnedOrder).toEqual([]);
});
test("legacy pins gain stable order once, new pins append, unpin removes only that slot", () => {
	const { store, file } = setup();
	const a = session("codex", 30);
	const b = session("claude", 20);
	const c = session("codex", 100);
	store.syncPins([a, b]);
	const restored = new SessionOrganizationStore(file);
	expect(
		restored.syncPins([{ ...b, lastModified: 300 }, a, c]).pinnedOrder,
	).toEqual([sessionKey(a), sessionKey(b), sessionKey(c)]);
	expect(restored.syncPins([b, c]).pinnedOrder).toEqual([
		sessionKey(b),
		sessionKey(c),
	]);
});
test("filtered project reordering retains all unseen sessions", () => {
	const { store } = setup();
	const a = session();
	const hidden = session("claude");
	const b = session();
	const project = store.apply({
		type: "createProject",
		name: "Work",
		session: a,
	}).projects[0];
	for (const s of [hidden, b])
		store.apply({ type: "assign", session: s, projectId: project.id });
	store.apply({
		type: "assign",
		session: b,
		projectId: project.id,
		target: sessionKey(a),
		after: false,
	});
	expect(store.read().projects[0].sessions).toEqual([
		sessionKey(b),
		sessionKey(a),
		sessionKey(hidden),
	]);
});
test("stale project or target failures preserve existing membership", () => {
	const { store } = setup();
	const a = session();
	const project = store.apply({
		type: "createProject",
		name: "Work",
		session: a,
	}).projects[0];
	expect(() =>
		store.apply({ type: "assign", session: a, projectId: crypto.randomUUID() }),
	).toThrow("no longer exists");
	expect(() =>
		store.apply({
			type: "assign",
			session: a,
			projectId: project.id,
			target: sessionKey(session()),
		}),
	).toThrow("target session moved");
	expect(store.read().projects[0].sessions).toEqual([sessionKey(a)]);
});
test("consecutive writes read latest state rather than clobbering another window", () => {
	const { store, file } = setup();
	const secondWindow = new SessionOrganizationStore(file);
	store.apply({ type: "createProject", name: "One" });
	secondWindow.apply({ type: "createProject", name: "Two" });
	expect(store.read().projects.map((p) => p.name)).toEqual(["One", "Two"]);
});
test("deleting a native session forgets only that provider's bookmark and membership", () => {
	const { store } = setup();
	const a = session();
	const b = { ...a, provider: "claude" as const };
	const p = store.apply({ type: "createProject", name: "Work", session: a })
		.projects[0];
	store.apply({ type: "assign", session: b, projectId: p.id });
	store.forget(a);
	expect(store.read().projects[0].sessions).toEqual([sessionKey(b)]);
	expect(store.read().bookmarks[sessionKey(a)]).toBeUndefined();
});
test("change events are emitted only after the snapshot is readable from disk", () => {
	const { store, file } = setup();
	let events = 0;
	store.on("change", (snapshot) => {
		events++;
		expect(new SessionOrganizationStore(file).read()).toEqual(snapshot);
	});
	store.apply({ type: "createProject", name: "Work" });
	expect(events).toBe(1);
});
