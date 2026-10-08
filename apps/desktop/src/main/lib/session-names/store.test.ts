import { describe, expect, test } from "bun:test";
import type { SessionNamesSnapshot } from "../../../shared/session-names";
import { SessionNameStore } from "./store";

function fixture() {
	let disk: SessionNamesSnapshot = { names: {}, aliases: {} };
	const legacy = new Map<string, string>();
	const prompts: string[] = [];
	const results: Array<(title: string | null) => void> = [];
	const io = {
		load: () => structuredClone(disk),
		save: (value: SessionNamesSnapshot) => {
			disk = structuredClone(value);
		},
		legacy: (id: string) => legacy.get(id) ?? null,
		mirror: (id: string, title: string | null) => {
			if (title) legacy.set(id, title);
			else legacy.delete(id);
		},
		generate: (prompt: string) => {
			prompts.push(prompt);
			return new Promise<string | null>((resolve) => results.push(resolve));
		},
	};
	return { store: new SessionNameStore(io), io, legacy, prompts, results };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("session naming authority", () => {
	test("terminal generation follows a new CLI binding without sending a second naming request", async () => {
		const { store, results, prompts } = fixture();
		store.startTerminal("t");
		store.firstPrompt({ provider: "terminal", id: "t" }, "Review login code");
		store.bindTerminal("t", "claude", "new-thread", true);
		store.firstPrompt(
			{ provider: "claude", id: "new-thread" },
			"Review login code",
		);
		results[0]("Review authentication code");
		await settle();
		expect(prompts).toHaveLength(1);
		expect(store.get({ provider: "claude", id: "new-thread" })).toBe(
			"Review authentication code",
		);
	});
	test("a new terminal's generated label cannot rename a resumed CLI conversation", async () => {
		const { store, results } = fixture();
		store.startTerminal("t");
		store.firstPrompt({ provider: "terminal", id: "t" }, "bun test");
		results[0]("Run project tests");
		await settle();
		store.bindTerminal("t", "codex", "existing", false);
		expect(store.get({ provider: "codex", id: "existing" })).toBeUndefined();
	});
	test("only the first real prompt of explicitly new sessions is summarized", async () => {
		const { store, prompts, results } = fixture();
		const ref = { provider: "codex", id: "new" } as const;
		store.open(ref, true);
		store.firstPrompt(ref, "/model");
		const prompt =
			"Hi, could you look at GatedSpace and fix the previews that fail after reopening?";
		store.firstPrompt(ref, prompt);
		store.firstPrompt(ref, "Another instruction");
		expect(prompts).toEqual([prompt]);
		results[0]("Fix GatedSpace preview recovery");
		await settle();
		expect(store.get(ref)).toBe("Fix GatedSpace preview recovery");
		expect(store.suggest(ref, "Another title")).toBe(false);
	});
	test("resumed sessions and legacy manual names are never automatically changed", () => {
		const { store, legacy, prompts } = fixture();
		for (const provider of ["claude", "codex", "terminal"] as const) {
			const ref = { provider, id: provider };
			store.open(ref, false);
			store.firstPrompt(ref, "Rename this");
			expect(store.suggest(ref, "New title")).toBe(false);
		}
		legacy.set("old", "My carefully chosen name");
		store.open({ provider: "claude", id: "old" }, true);
		store.firstPrompt(
			{ provider: "claude", id: "old" },
			"Please fix something",
		);
		expect(prompts).toHaveLength(0);
		expect(store.get({ provider: "claude", id: "old" })).toBe(
			"My carefully chosen name",
		);
	});
	test("a manual rename wins over in-flight generation, including a pending pane ID", async () => {
		const { store, results } = fixture();
		const ref = { provider: "claude", key: "pane" } as const;
		store.open(ref, true);
		store.firstPrompt(ref, "Fix the login");
		store.bind("claude", "pane", "session");
		store.rename({ provider: "claude", id: "session" }, "My login project");
		results[0]("Login fix");
		await settle();
		expect(store.get(ref)).toBe("My login project");
		expect(store.get({ provider: "claude", id: "session" })).toBe(
			"My login project",
		);
	});
	test("a name chosen before initialization follows the real session and survives restart", () => {
		const { store, io, legacy } = fixture();
		store.rename({ provider: "codex", key: "pane" }, "My task");
		store.bind("codex", "pane", "thread");
		const restored = new SessionNameStore(io);
		expect(restored.get({ provider: "codex", key: "pane" })).toBe("My task");
		expect(legacy.get("thread")).toBe("My task");
		restored.firstPrompt(
			{ provider: "codex", id: "thread" },
			"A new follow-up",
		);
		expect(
			restored.suggest({ provider: "codex", id: "thread" }, "Wrong title"),
		).toBe(false);
	});
	test("generation follows a pending pane binding and publishes a shared snapshot", async () => {
		const { store, results } = fixture();
		let changes = 0;
		store.on("change", () => changes++);
		store.open({ provider: "claude", key: "p" }, true);
		store.firstPrompt(
			{ provider: "claude", key: "p" },
			"Plan our Iceland trip",
		);
		store.bind("claude", "p", "id");
		results[0]("Plan the Iceland trip");
		await settle();
		expect(store.get({ provider: "claude", id: "id" })).toBe(
			"Plan the Iceland trip",
		);
		expect(changes).toBe(2);
	});
	test("reusing a pane never transfers the old session name to a new session", () => {
		const { store } = fixture();
		store.rename({ provider: "claude", key: "p" }, "Old title");
		store.bind("claude", "p", "old");
		store.open({ provider: "claude", key: "p" }, true);
		store.bind("claude", "p", "new");
		expect(store.get({ provider: "claude", id: "new" })).toBeUndefined();
		expect(store.get({ provider: "claude", id: "old" })).toBe("Old title");
	});
	test("terminal, native pane and mobile/recent stable ID share future renames", async () => {
		const { store, results, legacy } = fixture();
		store.startTerminal("terminal");
		store.bindTerminal("terminal", "codex", "thread", false);
		// An agent's hook can arrive before the first transcript record is flushed.
		store.bindTerminal("terminal", "codex", "thread", true);
		store.firstPrompt(
			{ provider: "codex", id: "thread" },
			"Fix login redirects",
		);
		results[0]("Fix login redirects");
		await settle();
		store.bind("codex", "pane", "thread");
		store.rename(
			{ provider: "terminal", id: "terminal" },
			"Authentication repair",
		);
		expect(store.get({ provider: "codex", key: "pane" })).toBe(
			"Authentication repair",
		);
		expect(legacy.get("thread")).toBe("Authentication repair");
		store.rename({ provider: "codex", id: "thread" }, "Login work");
		expect(store.get({ provider: "terminal", id: "terminal" })).toBe(
			"Login work",
		);
	});
	test("restored terminals can be linked and renamed but never automatically named", () => {
		const { store, prompts } = fixture();
		store.bindTerminal("restored", "claude", "old", false);
		store.firstPrompt({ provider: "claude", id: "old" }, "Please fix my app");
		expect(prompts).toHaveLength(0);
		store.rename({ provider: "terminal", id: "restored" }, "Existing project");
		expect(store.get({ provider: "claude", id: "old" })).toBe(
			"Existing project",
		);
	});
	test("plain terminals are named once and clearing a manual name cancels a late title", async () => {
		const { store, results } = fixture();
		const ref = { provider: "terminal", id: "shell" } as const;
		store.startTerminal("shell");
		store.firstPrompt(ref, "bun run test");
		store.rename(ref, null);
		results[0]("Run project tests");
		await settle();
		expect(store.get(ref)).toBeUndefined();
	});
});
