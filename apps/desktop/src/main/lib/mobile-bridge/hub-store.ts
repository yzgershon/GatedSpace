import { z } from "zod";

const shortText = z.string().trim().min(1).max(160);
export const hubReference = z
	.object({
		provider: z.enum(["claude", "codex"]),
		key: z.string().min(1).max(300),
		sessionId: z.string().max(300).optional(),
	})
	.strict();
const reference = hubReference;
const common = {
	id: z.string().uuid(),
	title: shortText,
	archived: z.boolean().default(false),
};
export const channelInput = z
	.object({
		...common,
		sessions: z.array(reference).max(100).default([]),
	})
	.strict();
export const taskInput = z
	.object({
		...common,
		notes: z.string().max(10_000).default(""),
		done: z.boolean().default(false),
		channelId: z.string().uuid().nullable().default(null),
		session: reference.nullable().default(null),
	})
	.strict();
export const outputInput = z
	.object({
		...common,
		body: z.string().min(1).max(40_000),
		channelId: z.string().uuid().nullable().default(null),
		source: reference.extend({ messageId: z.string().max(300) }).optional(),
	})
	.strict();
const metadata = {
	version: z.number().int().positive(),
	createdAt: z.number().int().nonnegative(),
	updatedAt: z.number().int().nonnegative(),
};
const schemas = {
	channels: channelInput.extend(metadata),
	tasks: taskInput.extend(metadata),
	outputs: outputInput.extend(metadata),
};
const stateSchema = z.object({
	format: z.literal(1),
	channels: z.array(schemas.channels).max(100),
	tasks: z.array(schemas.tasks).max(1_000),
	outputs: z.array(schemas.outputs).max(250),
});
export type HubState = z.infer<typeof stateSchema>;
export type HubKind = keyof typeof schemas;
export type HubRecord<K extends HubKind> = HubState[K][number];
export type HubSession = z.infer<typeof reference>;
const limits = { channels: 100, tasks: 1_000, outputs: 250 };
const empty = (): HubState => ({
	format: 1,
	channels: [],
	tasks: [],
	outputs: [],
});

export class HubConflict extends Error {}

/** One owner per store. A cloud adapter must resolve its owner before construction. */
export class MobileHubStore {
	private state?: HubState;
	private queue: Promise<unknown> = Promise.resolve();
	constructor(
		private readonly storage: {
			load: () => Promise<unknown | null>;
			save: (state: HubState) => Promise<void>;
		},
		private readonly now = Date.now,
	) {}

	private async loaded() {
		if (!this.state) {
			const saved = await this.storage.load();
			// An unreadable/corrupt store is an error, never an empty replacement.
			this.state = saved === null ? empty() : stateSchema.parse(saved);
		}
		return this.state;
	}

	private serial<T>(operation: () => Promise<T>): Promise<T> {
		const result = this.queue.then(operation);
		this.queue = result.catch(() => {});
		return result;
	}

	list() {
		return this.serial(async () => {
			const state = await this.loaded();
			return structuredClone({
				channels: state.channels,
				tasks: state.tasks,
				outputs: state.outputs.map(({ body, ...item }) => ({
					...item,
					excerpt: body.slice(0, 180),
				})),
			});
		});
	}

	get<K extends HubKind>(kind: K, id: string) {
		return this.serial(async () => {
			const found = (await this.loaded())[kind].find((r) => r.id === id);
			if (!found)
				throw new HubConflict("This item no longer exists. Refresh the page.");
			return structuredClone(found) as HubRecord<K>;
		});
	}

	/** A new pane gets its native thread id after startup. Fill it once, never
	 * replace an existing thread id or depend on ephemeral pane ids for resume. */
	resolveReference(input: unknown) {
		const ref = hubReference
			.extend({ sessionId: z.string().min(1).max(300) })
			.parse(input);
		return this.serial(async () => {
			const state = await this.loaded();
			const next = structuredClone(state);
			let changed = false;
			const matches = (s: HubSession | null | undefined) =>
				s && !s.sessionId && s.provider === ref.provider && s.key === ref.key;
			for (const record of [...next.channels, ...next.tasks, ...next.outputs]) {
				const refs =
					"sessions" in record
						? record.sessions
						: "session" in record
							? [record.session]
							: [record.source];
				let updated = false;
				for (const item of refs)
					if (item && matches(item)) {
						item.sessionId = ref.sessionId;
						updated = true;
					}
				if (updated) {
					record.version++;
					record.updatedAt = this.now();
					changed = true;
				}
			}
			if (changed) {
				await this.storage.save(next);
				this.state = next;
			}
			return { changed };
		});
	}

	write<K extends HubKind>(kind: K, input: unknown, expectedVersion?: number) {
		return this.serial(async () => {
			const state = await this.loaded();
			const schema =
				kind === "channels"
					? channelInput
					: kind === "tasks"
						? taskInput
						: outputInput;
			const data = schema.parse(input);
			const records = state[kind];
			const previous = records.find((r) => r.id === data.id);
			if (expectedVersion === undefined && previous) {
				// An uncertain create can be retried with the same id, without duplication.
				if (
					JSON.stringify(schema.strip().parse(previous)) ===
					JSON.stringify(data)
				)
					return structuredClone(previous) as HubRecord<K>;
				throw new HubConflict(
					"That request already created a different item. Refresh and try again.",
				);
			}
			if (
				expectedVersion !== undefined &&
				(!previous || previous.version !== expectedVersion)
			) {
				throw new HubConflict(
					"This item changed on another screen. Refresh before saving again.",
				);
			}
			if (!previous && records.length >= limits[kind])
				throw new HubConflict("This library is full.");
			if (
				"channelId" in data &&
				data.channelId &&
				!state.channels.some(
					(c) =>
						c.id === data.channelId &&
						(!c.archived ||
							(previous &&
								"channelId" in previous &&
								previous.channelId === data.channelId)),
				)
			) {
				throw new HubConflict("Choose an available channel.");
			}
			const now = this.now();
			const item = {
				...data,
				version: (previous?.version ?? 0) + 1,
				createdAt: previous?.createdAt ?? now,
				updatedAt: now,
			};
			const next = stateSchema.parse({
				...state,
				[kind]: previous
					? records.map((r) => (r.id === data.id ? item : r))
					: [...records, item],
			});
			await this.storage.save(next);
			this.state = next;
			return structuredClone(item) as HubRecord<K>;
		});
	}
}
