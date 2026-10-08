import claude from "../../../../packages/ui/src/assets/icons/preset-icons/claude.svg";
import codex from "../../../../packages/ui/src/assets/icons/preset-icons/codex.svg";
import {
	emptyOrganization,
	type OrganizationCommand,
	updateOrganization,
} from "../../src/shared/session-organization";
import type {
	QueuedPrompt,
	SessionQueueState,
} from "../../src/shared/session-queue";
export const usePresetIcon = (provider: string) =>
	provider === "codex" ? codex : claude;
export const useLocalHostService = () => ({ activeHostUrl: "fixture" });
export const useCopyToClipboard = () => ({
	copyToClipboard: async (_text: string) => {},
});
export const getHostTrpcClient = () => ({
	terminalAgents: { list: { query: async () => [] } },
});
const rows = [
	{
		provider: "claude",
		sessionId: "00000000-0000-4000-8000-000000000001",
		title: "Filtrsoft reliability audit",
		cwd: "C:/Dev/filtrsoft",
		lastModified: Date.now() - 50_000,
		pinned: false,
		archived: false,
	},
	{
		provider: "codex",
		sessionId: "00000000-0000-4000-8000-000000000002",
		title: "GatedSpace Edits",
		cwd: "C:/Dev/superset",
		lastModified: Date.now() - 30_000,
		pinned: true,
		archived: false,
	},
	{
		provider: "codex",
		sessionId: "00000000-0000-4000-8000-000000000003",
		title: "Preview sizing",
		cwd: "C:/Dev/superset",
		lastModified: Date.now() - 100_000,
		pinned: false,
		archived: false,
	},
];
let organization = emptyOrganization();
const queues: Record<string, SessionQueueState> = {};
const listeners = new Map<string, (state: SessionQueueState) => void>();
function state(key: string) {
	queues[key] ??= {
		entries: [
			{
				id: crypto.randomUUID(),
				createdAt: Date.now(),
				prompt: {
					provider: key === "claude" ? "claude" : "codex",
					text: "Check the narrow pane layout too.",
					model: "model",
					effort: "high",
					permission: "default",
				},
			},
		],
		paused: false,
	};
	return queues[key];
}
function change(key: string) {
	listeners.get(key)?.(structuredClone(state(key)));
}
const mutation = <T>(action: (input: T) => unknown) => ({
	mutate: async (input: T) => action(input),
});
export const electronTrpcClient = {
	claudeSessions: {
		organization: { query: async () => organization },
		watchOrganization: { subscribe: () => ({ unsubscribe() {} }) },
		organize: {
			mutate: async (command: OrganizationCommand) => {
				organization = updateOrganization(
					organization,
					command,
					rows
						.filter((r) => r.pinned)
						.map((r) => ({ ...r, provider: r.provider as "claude" | "codex" })),
				);
				return organization;
			},
		},
		list: {
			query: async (input: { provider: string; archived?: boolean }) =>
				rows.filter(
					(r) =>
						r.provider === input.provider &&
						r.archived === Boolean(input.archived),
				),
		},
		searchContent: { query: async () => [] },
		pin: mutation((input: { sessionId: string; pinned: boolean }) =>
			Object.assign(rows.find((r) => r.sessionId === input.sessionId) ?? {}, {
				pinned: input.pinned,
			}),
		),
		setArchived: mutation((input: { sessionId: string; archived: boolean }) =>
			Object.assign(rows.find((r) => r.sessionId === input.sessionId) ?? {}, {
				archived: input.archived,
			}),
		),
		rename: mutation((input: { sessionId: string; title: string }) =>
			Object.assign(rows.find((r) => r.sessionId === input.sessionId) ?? {}, {
				title: input.title,
			}),
		),
	},
	claudeSession: { liveSessionIds: { query: async () => [] } },
	codexSession: { liveSessionIds: { query: async () => [] } },
	notifications: {
		sessionStates: {
			subscribe: (
				_input: unknown,
				handlers: { onData: (states: unknown[]) => void },
			) => {
				handlers.onData([
					{
						provider: "codex",
						sessionId: rows[1]?.sessionId,
						status: "working",
					},
				]);
				return { unsubscribe() {} };
			},
		},
	},
	sessionQueue: {
		stream: {
			subscribe: (
				input: { key: string },
				handlers: { onData: (state: SessionQueueState) => void },
			) => {
				listeners.set(input.key, handlers.onData);
				change(input.key);
				return {
					unsubscribe() {
						listeners.delete(input.key);
					},
				};
			},
		},
		enqueue: mutation((input: { key: string; prompt: QueuedPrompt }) => {
			state(input.key).entries.push({
				id: crypto.randomUUID(),
				createdAt: Date.now(),
				prompt: input.prompt,
			});
			change(input.key);
		}),
		pause: mutation((input: { key: string }) => {
			state(input.key).paused = true;
			state(input.key).pauseVersion = (state(input.key).pauseVersion ?? 0) + 1;
			change(input.key);
			return state(input.key).pauseVersion;
		}),
		resume: mutation((input: { key: string }) => {
			state(input.key).paused = false;
			change(input.key);
		}),
		beginEdit: mutation((input: { key: string; id: string }) => {
			const queue = state(input.key);
			const entry = queue.entries.find((e) => e.id === input.id);
			if (!entry) throw new Error("Message no longer queued");
			const resume = !queue.paused;
			queue.paused = true;
			queue.pauseVersion = (queue.pauseVersion ?? 0) + 1;
			change(input.key);
			return {
				entry: structuredClone(entry),
				resume,
				pauseVersion: queue.pauseVersion,
			};
		}),
		replace: mutation(
			(input: { key: string; id: string; prompt: QueuedPrompt }) => {
				const entry = state(input.key).entries.find((e) => e.id === input.id);
				if (entry) entry.prompt = input.prompt;
				change(input.key);
			},
		),
		edit: mutation((input: { key: string; id: string; text: string }) => {
			const entry = state(input.key).entries.find((e) => e.id === input.id);
			if (entry) entry.prompt.text = input.text;
			change(input.key);
		}),
		remove: mutation((input: { key: string; id: string }) => {
			state(input.key).entries = state(input.key).entries.filter(
				(e) => e.id !== input.id,
			);
			change(input.key);
		}),
		steer: mutation((input: { key: string; id: string }) => {
			state(input.key).entries = state(input.key).entries.filter(
				(e) => e.id !== input.id,
			);
			change(input.key);
		}),
	},
};
