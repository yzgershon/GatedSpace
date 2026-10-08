import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { observable } from "@trpc/server/observable";
import { SUPERSET_HOME_DIR } from "main/lib/app-environment";
import { claudeSessionManager } from "main/lib/claude-session/session-manager";
import { codexSessionManager } from "main/lib/codex-session/session-manager";
import { sessionEvents } from "main/lib/notifications/session-events";
import { ensureSecureDir } from "main/lib/secure-file";
import { SessionQueue } from "main/lib/session-queue/session-queue";
import {
	queuedPromptSchema,
	type SessionQueueState,
} from "shared/session-queue";
import { z } from "zod";
import { publicProcedure, router } from "../..";

const stateSchema = z.object({
	entries: z.array(
		z.object({
			id: z.string(),
			createdAt: z.number(),
			prompt: queuedPromptSchema,
		}),
	),
	paused: z.boolean(),
	pauseVersion: z.number().optional(),
	error: z.string().optional(),
	sendingId: z.string().optional(),
	sessionId: z.string().optional(),
});
let instance: SessionQueue | undefined;
function getQueue() {
	if (instance) return instance;
	const directory = join(SUPERSET_HOME_DIR, "message-queues");
	const path = join(directory, "queues.json");
	ensureSecureDir(directory);
	instance = new SessionQueue(
		sessionEvents,
		{
			load() {
				try {
					return z
						.record(z.string(), stateSchema)
						.parse(JSON.parse(readFileSync(path, "utf8")));
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
					throw new Error(
						"Couldn't read the saved message queue. Its file has been preserved.",
					);
				}
			},
			save(queues) {
				// The directory has an owner-only ACL; atomic replacements inherit it.
				writeFileSync(`${path}.tmp`, JSON.stringify(queues), { mode: 0o600 });
				renameSync(`${path}.tmp`, path);
			},
		},
		async (key, prompt, steer) => {
			if (prompt.provider === "codex") {
				if (steer) await codexSessionManager.steer({ key, ...prompt });
				else await codexSessionManager.send({ key, ...prompt });
			} else claudeSessionManager.send(key, prompt.text, false, prompt.images);
		},
	);
	return instance;
}
const keyInput = z.object({ key: z.string().min(1).max(200) });
const entryInput = keyInput.extend({ id: z.string().uuid() });
export const createSessionQueueRouter = () =>
	router({
		get: publicProcedure
			.input(keyInput)
			.query(({ input }) => getQueue().get(input.key)),
		enqueue: publicProcedure
			.input(keyInput.extend({ prompt: queuedPromptSchema }))
			.mutation(({ input }) => getQueue().enqueue(input.key, input.prompt)),
		edit: publicProcedure
			.input(entryInput.extend({ text: z.string().max(100_000) }))
			.mutation(({ input }) =>
				getQueue().edit(input.key, input.id, input.text),
			),
		beginEdit: publicProcedure
			.input(entryInput)
			.mutation(({ input }) => getQueue().beginEdit(input.key, input.id)),
		replace: publicProcedure
			.input(entryInput.extend({ prompt: queuedPromptSchema }))
			.mutation(({ input }) =>
				getQueue().replace(input.key, input.id, input.prompt),
			),
		remove: publicProcedure
			.input(entryInput)
			.mutation(({ input }) => getQueue().remove(input.key, input.id)),
		pause: publicProcedure
			.input(keyInput)
			.mutation(({ input }) => getQueue().pause(input.key)),
		resume: publicProcedure
			.input(keyInput.extend({ expectedPauseVersion: z.number().optional() }))
			.mutation(({ input }) =>
				getQueue().resume(input.key, input.expectedPauseVersion),
			),
		steer: publicProcedure
			.input(entryInput)
			.mutation(({ input }) => getQueue().steer(input.key, input.id)),
		stream: publicProcedure.input(keyInput).subscription(({ input }) =>
			observable<SessionQueueState>((emit) => {
				const queue = getQueue();
				const handler = (state: SessionQueueState) => emit.next(state);
				queue.on(input.key, handler);
				emit.next(queue.get(input.key));
				return () => {
					queue.off(input.key, handler);
				};
			}),
		),
	});
