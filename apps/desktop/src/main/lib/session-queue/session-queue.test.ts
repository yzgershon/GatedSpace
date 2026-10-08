import { describe, expect, test } from "bun:test";
import type { ResultEvent } from "../../../shared/claude-session/events";
import type {
	QueuedPrompt,
	SessionQueueState,
} from "../../../shared/session-queue";
import { ClaudeTurnNotifications } from "../notifications/claude-turn-notifications";
import { SessionEvents } from "../notifications/session-events";
import { SessionQueue } from "./session-queue";

const prompt = (text: string): QueuedPrompt => ({
	provider: "codex",
	text,
	model: "model",
	effort: "high",
	permission: "default",
	images: ["data:image/png;base64,aGVsbG8="],
});
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
function setup(
	saved: Record<string, SessionQueueState> = {},
	dispatch?: (
		key: string,
		prompt: QueuedPrompt,
		steer: boolean,
	) => Promise<void>,
) {
	const events = new SessionEvents();
	events.open("pane", "codex");
	events.bind("pane", "session");
	events.work("pane", "first");
	const sent: string[] = [];
	const notices: string[] = [];
	events.on("notice", (s) => notices.push(s.status));
	const storage = {
		load: () => structuredClone(saved),
		save: (value: typeof saved) => {
			saved = structuredClone(value);
		},
	};
	const queue = new SessionQueue(
		events,
		storage,
		dispatch ??
			(async (_key, message) => {
				sent.push(message.text);
				events.work("pane", message.text);
			}),
	);
	return { events, queue, sent, notices, storage, saved: () => saved };
}
describe("session outbox", () => {
	for (const provider of ["claude", "codex"] as const) {
		test(`${provider}: queue before first init binds and dispatches all follow-ups once`, async () => {
			const events = new SessionEvents();
			events.open("fresh", provider);
			const claude = new ClaudeTurnNotifications(events);
			const sent: string[] = [];
			const begin = (id: string) =>
				provider === "claude"
					? claude.sent("fresh", id, id)
					: events.work("fresh", id);
			const finish = (id: string) => {
				if (provider === "codex") events.finish("fresh", id, true);
				else
					claude.event("fresh", {
						type: "result",
						subtype: "success",
						uuid: id,
						is_error: false,
						permission_denials: [{ tool_name: "unused tool" }],
					} as ResultEvent);
			};
			const queue = new SessionQueue(
				events,
				{ load: () => ({}), save: () => {} },
				async (_key, prompt) => {
					sent.push(prompt.text);
					begin(prompt.text);
				},
			);
			begin("first");
			queue.enqueue(
				"fresh",
				provider === "claude" ? { provider, text: "second" } : prompt("second"),
			);
			events.bind("fresh", "assigned-after-send");
			queue.enqueue(
				"fresh",
				provider === "claude" ? { provider, text: "third" } : prompt("third"),
			);
			finish("first");
			await tick();
			expect(sent).toEqual(["second"]);
			finish("second");
			await tick();
			expect(sent).toEqual(["second", "third"]);
			finish("third");
			await tick();
			expect(queue.get("fresh").entries).toHaveLength(0);
		});
	}
	test("composer edit holds the entry through completion and preserves its position and attachments", async () => {
		const { events, queue, sent } = setup();
		const id = queue.enqueue("pane", prompt("before"));
		queue.enqueue("pane", prompt("later"));
		const held = queue.beginEdit("pane", id);
		events.finish("pane", "first", true);
		await tick();
		expect(sent).toEqual([]);
		queue.replace("pane", id, { ...held.entry.prompt, text: "edited" });
		queue.resume("pane", held.pauseVersion);
		await tick();
		expect(sent).toEqual(["edited"]);
		expect(queue.get("pane").entries[0]?.prompt.text).toBe("later");
	});
	test("an unbound restored queue cannot silently adopt a new conversation", async () => {
		const { events, queue } = setup({
			pane: {
				entries: [{ id: "saved", createdAt: 0, prompt: prompt("private") }],
				paused: false,
			},
		});
		events.open("pane", "codex");
		events.bind("pane", "new-session");
		expect(queue.get("pane").sessionId).toBeUndefined();
		expect(() => queue.resume("pane")).toThrow("original conversation");
	});
	test("waits for the actual turn; delivers FIFO once, suppressing intermediate completion", async () => {
		const { events, queue, sent, notices } = setup();
		queue.enqueue("pane", prompt("second"));
		queue.enqueue("pane", prompt("third"));
		await tick();
		expect(sent).toEqual([]);
		events.finish("pane", "unrelated-child", true);
		await tick();
		expect(sent).toEqual([]);
		events.finish("pane", "first", true);
		await tick();
		expect(sent).toEqual(["second"]);
		expect(notices).toEqual([]);
		events.finish("pane", "first", true);
		await tick();
		expect(sent).toEqual(["second"]);
		events.finish("pane", "second", true);
		await tick();
		expect(sent).toEqual(["second", "third"]);
		events.finish("pane", "third", true);
		expect(notices).toEqual(["completed"]);
	});
	test("question blocks dispatch; interrupted and failed turns pause", async () => {
		for (const action of ["question", "stop", "failure"]) {
			const { events, queue, sent } = setup();
			queue.enqueue("pane", prompt("next"));
			if (action === "question") events.finish("pane", "first", true, true);
			if (action === "stop") events.status("pane", "idle");
			if (action === "failure") events.finish("pane", "first", false);
			await tick();
			expect(sent).toEqual([]);
			if (action !== "question") expect(queue.get("pane").paused).toBe(true);
		}
	});
	test("editing pauses, retains images and settings, then resumes the updated message", async () => {
		const { events, queue, sent } = setup();
		const id = queue.enqueue("pane", prompt("before"));
		queue.pause("pane");
		events.finish("pane", "first", true);
		await tick();
		expect(sent).toEqual([]);
		queue.edit("pane", id, "after");
		expect(queue.get("pane").entries[0]?.prompt).toEqual(prompt("after"));
		queue.resume("pane");
		await tick();
		expect(sent).toEqual(["after"]);
	});
	test("deleted messages never dispatch", async () => {
		const { events, queue, sent } = setup();
		queue.remove("pane", queue.enqueue("pane", prompt("removed")));
		events.finish("pane", "first", true);
		await tick();
		expect(sent).toEqual([]);
	});
	test("saving an edit cannot override a Stop received while editing", async () => {
		const { events, queue, sent } = setup();
		const id = queue.enqueue("pane", prompt("before"));
		const editingPause = queue.pause("pane");
		events.status("pane", "idle");
		queue.edit("pane", id, "after");
		queue.resume("pane", editingPause);
		await tick();
		expect(sent).toEqual([]);
		expect(queue.get("pane").paused).toBe(true);
		queue.resume("pane");
		await tick();
		expect(sent).toEqual(["after"]);
	});
	test("a fast final turn still notifies once when completion precedes send acknowledgement", async () => {
		let events: SessionEvents;
		const current = setup({}, async (_key, message) => {
			events.work("pane", message.text);
			events.finish("pane", message.text, true);
		});
		events = current.events;
		current.queue.enqueue("pane", prompt("fast"));
		events.finish("pane", "first", true);
		await tick();
		expect(current.queue.get("pane").entries).toEqual([]);
		expect(current.notices).toEqual(["completed"]);
	});
	test("failure keeps the message, pauses, and never retries automatically", async () => {
		let count = 0;
		const { events, queue } = setup({}, async () => {
			count++;
			throw new Error("Connection closed");
		});
		queue.enqueue("pane", prompt("retain"));
		events.finish("pane", "first", true);
		await tick();
		await tick();
		expect(count).toBe(1);
		expect(queue.get("pane")).toMatchObject({
			paused: true,
			error: "Connection closed",
			entries: [{ prompt: { text: "retain" } }],
		});
	});
	test("restored queue never auto-sends after a crash", async () => {
		const first = setup();
		first.queue.enqueue("pane", prompt("saved"));
		const restored = setup(first.saved());
		restored.events.finish("pane", "first", true);
		await tick();
		expect(restored.sent).toEqual([]);
		expect(restored.queue.get("pane").paused).toBe(true);
		restored.queue.resume("pane");
		await tick();
		expect(restored.sent).toEqual(["saved"]);
	});
	test("cannot replay into a different conversation on the same pane", async () => {
		const { events, queue, sent } = setup();
		queue.enqueue("pane", prompt("private"));
		events.close("pane");
		events.open("pane", "codex");
		events.bind("pane", "other");
		expect(() => queue.resume("pane")).toThrow("original conversation");
		await tick();
		expect(sent).toEqual([]);
	});
	test("save failure does not acknowledge or send a message", async () => {
		const { queue, storage, sent } = setup();
		storage.save = () => {
			throw new Error("disk full");
		};
		expect(() => queue.enqueue("pane", prompt("unsaved"))).toThrow("disk full");
		await tick();
		expect(sent).toEqual([]);
		expect(queue.get("pane").entries).toEqual([]);
	});
	test("steer removes only the selected message and cannot race a pending delivery", async () => {
		let release: (() => void) | undefined;
		const calls: boolean[] = [];
		const { queue } = setup({}, async (_key, _prompt, steer) => {
			calls.push(steer);
			await new Promise<void>((r) => {
				release = r;
			});
		});
		const first = queue.enqueue("pane", prompt("first"));
		const second = queue.enqueue("pane", prompt("second"));
		const sending = queue.steer("pane", second);
		expect(() => queue.remove("pane", second)).toThrow("started sending");
		await expect(queue.steer("pane", first)).rejects.toThrow(
			"still being sent",
		);
		release?.();
		await sending;
		expect(calls).toEqual([true]);
		expect(queue.get("pane").entries.map((e) => e.id)).toEqual([first]);
	});
});
