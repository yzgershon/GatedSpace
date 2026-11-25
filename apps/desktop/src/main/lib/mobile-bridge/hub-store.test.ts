import { describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { HubConflict, type HubState, MobileHubStore } from "./hub-store";

function fixture() {
	let saved: HubState | null = null;
	let fail = false;
	const storage = {
		load: async () => saved,
		save: async (data: HubState) => {
			if (fail) throw new Error("disk full");
			saved = structuredClone(data);
		},
	};
	return {
		store: new MobileHubStore(storage),
		reopen: () => new MobileHubStore(storage),
		fail: () => {
			fail = true;
		},
	};
}
describe("mobile workspace persistence", () => {
	it("fills stable thread references once without changing provider or overwriting a linked thread", async () => {
		const f = fixture();
		const session = { provider: "codex", key: "new-pane" };
		const task = await f.store.write("tasks", {
			id: randomUUID(),
			title: "New",
			session,
		});
		await f.store.write("channels", {
			id: randomUUID(),
			title: "Project",
			sessions: [session],
		});
		await f.store.write("outputs", {
			id: randomUUID(),
			title: "Reply",
			body: "Retained",
			source: { ...session, messageId: "m1" },
		});
		expect(
			await f.store.resolveReference({
				...session,
				provider: "claude",
				sessionId: "wrong-provider",
			}),
		).toEqual({ changed: false });
		expect(
			await f.store.resolveReference({
				...session,
				sessionId: "native-thread",
			}),
		).toEqual({ changed: true });
		expect(
			await f.store.resolveReference({
				...session,
				sessionId: "different-thread",
			}),
		).toEqual({ changed: false });
		const saved = await f.reopen().list();
		expect(saved.tasks[0].session?.sessionId).toBe("native-thread");
		expect(saved.channels[0].sessions[0].sessionId).toBe("native-thread");
		expect(saved.outputs[0].source?.sessionId).toBe("native-thread");
		expect(saved.tasks[0].version).toBe(task.version + 1);
	});
	it("retains channels, tasks and outputs after restart without sending work", async () => {
		const f = fixture();
		const channel = await f.store.write("channels", {
			id: randomUUID(),
			title: "Project",
		});
		const task = await f.store.write("tasks", {
			id: randomUUID(),
			title: "Review",
			channelId: channel.id,
			session: { provider: "codex", key: "pane", sessionId: "thread" },
		});
		const output = await f.store.write("outputs", {
			id: randomUUID(),
			title: "Summary",
			body: "A saved response",
			channelId: channel.id,
		});
		const reopened = f.reopen();
		expect((await reopened.list()).tasks[0]).toEqual(task);
		expect((await reopened.get("outputs", output.id)).body).toBe(
			"A saved response",
		);
		expect((await reopened.list()).outputs[0]).not.toHaveProperty("body");
		expect(task.done).toBe(false);
	});
	it("deduplicates uncertain create retries and rejects changed payloads", async () => {
		const { store } = fixture();
		const input = { id: randomUUID(), title: "Review" };
		const [first, repeated] = await Promise.all([
			store.write("tasks", input),
			store.write("tasks", input),
		]);
		expect(first).toEqual(repeated);
		expect((await store.list()).tasks).toHaveLength(1);
		await expect(
			store.write("tasks", { ...input, title: "Changed" }),
		).rejects.toBeInstanceOf(HubConflict);
	});
	it("rejects stale edits and preserves successful concurrent changes", async () => {
		const { store } = fixture();
		const input = { id: randomUUID(), title: "Review" };
		await store.write("tasks", input);
		const operations = await Promise.allSettled([
			store.write("tasks", { ...input, done: true }, 1),
			store.write("tasks", { ...input, title: "Other device" }, 1),
		]);
		expect(operations.map((o) => o.status)).toEqual(["fulfilled", "rejected"]);
		expect((await store.get("tasks", input.id)).done).toBe(true);
	});
	it("does not publish a failed write into its memory cache", async () => {
		const f = fixture();
		const input = { id: randomUUID(), title: "Original" };
		await f.store.write("tasks", input);
		f.fail();
		await expect(
			f.store.write("tasks", { ...input, title: "Failed" }, 1),
		).rejects.toThrow("disk full");
		expect((await f.store.get("tasks", input.id)).title).toBe("Original");
	});
	it("does not overwrite corrupt persisted state with an empty library", async () => {
		let writes = 0;
		const store = new MobileHubStore({
			load: async () => ({ format: 999 }),
			save: async () => {
				writes++;
			},
		});
		await expect(
			store.write("tasks", { id: randomUUID(), title: "New" }),
		).rejects.toThrow();
		expect(writes).toBe(0);
	});
	it("validates channel references, field sizes and provider identity", async () => {
		const { store } = fixture();
		await expect(
			store.write("tasks", {
				id: randomUUID(),
				title: "New",
				channelId: randomUUID(),
			}),
		).rejects.toThrow("available channel");
		await expect(
			store.write("outputs", {
				id: randomUUID(),
				title: "New",
				body: "x".repeat(40001),
			}),
		).rejects.toThrow();
		await expect(
			store.write("tasks", {
				id: randomUUID(),
				title: "New",
				session: { provider: "missing", key: "pane" },
			}),
		).rejects.toThrow();
	});
});
