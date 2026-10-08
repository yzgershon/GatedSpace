import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type {
	QueuedMessage,
	QueuedPrompt,
	SessionQueueState,
} from "../../../shared/session-queue";
import type { SessionEvents } from "../notifications/session-events";

type SavedQueues = Record<string, SessionQueueState>;
interface QueueStorage {
	load(): SavedQueues;
	save(queues: SavedQueues): void;
}
type Dispatch = (
	key: string,
	prompt: QueuedPrompt,
	steer: boolean,
) => Promise<void>;

/** A main-process outbox: changing tabs cannot deliver, lose, or replay a prompt. */
export class SessionQueue extends EventEmitter {
	private queues: SavedQueues;
	private busy = new Set<string>();
	constructor(
		private events: SessionEvents,
		private storage: QueueStorage,
		private dispatch: Dispatch,
	) {
		super();
		this.queues = storage.load();
		for (const queue of Object.values(this.queues)) {
			queue.paused = true;
			if (queue.sendingId)
				queue.error =
					"Delivery was interrupted. Check the conversation before sending this message again.";
			queue.sendingId = undefined;
		}
		events.hasQueuedContinuation = (key) => this.ready(key);
		events.on("bound", ({ key, sessionId, previousId }) => {
			const queue = this.get(key);
			// A first prompt can be queued before Claude's system/init arrives.
			// Only bind a live, unpaused queue; never adopt a restored queue or fork.
			if (
				!previousId &&
				!queue.sessionId &&
				!queue.paused &&
				queue.entries.length
			) {
				try {
					this.commit(key, { ...queue, sessionId });
				} catch {
					this.queues[key] = {
						...queue,
						paused: true,
						error: "Couldn't save the queue. Delivery is paused.",
					};
					this.emit(key, this.get(key));
				}
			}
		});
		events.on("change", (state) => {
			if (!state) return;
			if (state.status === "completed")
				queueMicrotask(() => void this.pump(state.key));
			else if (state.status === "idle" || state.status === "error") {
				try {
					this.pause(state.key);
				} catch {
					const queue = this.queues[state.key];
					if (queue) {
						queue.paused = true;
						queue.error = "Couldn't save the queue. Delivery is paused.";
						this.emit(state.key, this.get(state.key));
					}
				}
			}
		});
	}
	get(key: string): SessionQueueState {
		return structuredClone(this.queues[key] ?? { entries: [], paused: false });
	}
	private commit(key: string, next: SessionQueueState) {
		const queues = { ...this.queues, [key]: next };
		this.storage.save(queues); // Persist before acknowledging or delivering anything.
		this.queues = queues;
		this.emit(key, this.get(key));
	}
	private ready(key: string) {
		const queue = this.queues[key];
		const session = this.events.get(key);
		return Boolean(
			queue?.entries.length &&
				!queue.paused &&
				session &&
				queue.sessionId === session.sessionId,
		);
	}
	enqueue(key: string, prompt: QueuedPrompt) {
		const session = this.events.get(key);
		if (!session || session.provider !== prompt.provider)
			throw new Error("Open this session before queuing a message.");
		if (!prompt.text.trim() && !prompt.images?.length)
			throw new Error("Add a message or an image.");
		const queue = this.get(key);
		if (queue.entries.length >= 20)
			throw new Error(
				"The queue is full (20 messages). Send or remove a message first.",
			);
		if (queue.entries.length && queue.sessionId !== session.sessionId)
			throw new Error(
				"This queue belongs to another conversation. Remove its messages before adding new ones.",
			);
		const entry: QueuedMessage = {
			id: randomUUID(),
			createdAt: Date.now(),
			prompt,
		};
		if (!queue.entries.length) {
			queue.paused = false;
			queue.error = undefined;
		}
		queue.entries.push(entry);
		queue.sessionId = session.sessionId;
		if (JSON.stringify(queue).length > 30_000_000)
			throw new Error(
				"The queue's attachments are too large. Send some messages first.",
			);
		this.commit(key, queue);
		queueMicrotask(() => void this.pump(key));
		return entry.id;
	}
	pause(key: string) {
		const queue = this.get(key);
		if (!queue.entries.length) return queue.pauseVersion ?? 0;
		queue.paused = true;
		queue.pauseVersion = (queue.pauseVersion ?? 0) + 1;
		this.commit(key, queue);
		return queue.pauseVersion;
	}
	resume(key: string, expectedPauseVersion?: number) {
		const queue = this.get(key);
		// Finishing an edit must not override a Stop that arrived during editing.
		if (
			expectedPauseVersion !== undefined &&
			queue.pauseVersion !== expectedPauseVersion
		)
			return;
		if (queue.sessionId !== this.events.get(key)?.sessionId)
			throw new Error("Reopen the original conversation to resume its queue.");
		queue.paused = false;
		queue.error = undefined;
		this.commit(key, queue);
		queueMicrotask(() => void this.pump(key));
	}
	edit(key: string, id: string, text: string) {
		const queue = this.get(key);
		const entry = queue.entries.find((e) => e.id === id);
		if (!entry || queue.sendingId === id)
			throw new Error("This message has already started sending.");
		if (!text.trim() && !entry.prompt.images?.length)
			throw new Error("Add a message or an image.");
		entry.prompt.text = text;
		this.commit(key, queue);
	}
	beginEdit(key: string, id: string) {
		const queue = this.get(key);
		const entry = queue.entries.find((e) => e.id === id);
		if (!entry || queue.sendingId === id)
			throw new Error("This message has already started sending.");
		const resume = !queue.paused;
		const pauseVersion = this.pause(key);
		return { entry, resume, pauseVersion };
	}
	replace(key: string, id: string, prompt: QueuedPrompt) {
		const queue = this.get(key);
		const entry = queue.entries.find((e) => e.id === id);
		if (!entry || queue.sendingId === id)
			throw new Error("This message has already started sending.");
		if (prompt.provider !== entry.prompt.provider)
			throw new Error("The message belongs to a different agent.");
		if (!prompt.text.trim() && !prompt.images?.length)
			throw new Error("Add a message or an image.");
		entry.prompt = prompt;
		if (JSON.stringify(queue).length > 30_000_000)
			throw new Error("The queue's attachments are too large.");
		this.commit(key, queue);
	}
	remove(key: string, id: string) {
		const queue = this.get(key);
		if (queue.sendingId === id)
			throw new Error("This message has already started sending.");
		queue.entries = queue.entries.filter((e) => e.id !== id);
		this.commit(key, queue);
	}
	async steer(key: string, id: string) {
		const state = this.events.get(key);
		if (state?.status === "attention")
			throw new Error("Answer the pending question first.");
		if (this.busy.has(key))
			throw new Error("A queued message is still being sent.");
		await this.deliver(key, id, state?.status === "working");
	}
	private async pump(key: string) {
		if (!this.ready(key) || this.busy.has(key)) return;
		const status = this.events.get(key)?.status;
		if (status !== "completed" && status !== "idle") return;
		const first = this.queues[key]?.entries[0];
		if (first) await this.deliver(key, first.id, false).catch(() => {});
	}
	private async deliver(key: string, id: string, steer: boolean) {
		const queue = this.get(key);
		if (queue.sessionId !== this.events.get(key)?.sessionId)
			throw new Error("This queue belongs to another conversation.");
		const entry = queue.entries.find((e) => e.id === id);
		if (!entry) throw new Error("The message is no longer queued.");
		this.busy.add(key);
		try {
			this.commit(key, { ...queue, sendingId: id });
			await this.dispatch(key, entry.prompt, steer);
			const current = this.get(key);
			current.entries = current.entries.filter((e) => e.id !== id);
			current.sendingId = undefined;
			this.commit(key, current);
			if (!current.entries.length) this.events.flushQueuedCompletion(key);
		} catch (error) {
			this.commit(key, {
				...this.get(key),
				sendingId: undefined,
				paused: true,
				error: error instanceof Error ? error.message : String(error),
			});
			throw error;
		} finally {
			this.busy.delete(key);
			queueMicrotask(() => void this.pump(key));
		}
	}
}
