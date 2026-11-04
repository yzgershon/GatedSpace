/** Simulated IPC only. No credentials, provider requests or real account changes. */

import { normalizeCodexLimits } from "../../src/shared/codex-session/controls";
import type { CodexSessionState } from "../../src/shared/codex-session/types";
import { electronTrpcClient as base } from "../codex-session/fixture-client";

const accounts = [
	{ id: "personal", label: "Personal", ready: true, detail: "Pro" },
	{ id: "school", label: "School", ready: true, detail: "Plus" },
	{ id: "work", label: "Work", ready: true, detail: "Pro" },
];
const profiles = [
	{
		id: "writing",
		label: "Writing",
		configDir: "fixture/claude-writing",
		ready: true,
		exhausted: false,
	},
];
const profile = { mode: "writing", activeProfileId: "writing", profiles };
const listeners = new Set<(state: CodexSessionState) => void>();
let state: CodexSessionState;
let failSwitch = false;
let unavailable = false;
let forceReads = 0;
const publish = () => {
	for (const listener of listeners) listener(structuredClone(state));
};
export function quotaFixture() {
	state = {
		...state,
		status: "idle",
		error: "You've hit your usage limit.",
		usageLimit: {
			id: crypto.randomUUID(),
			accountId: state.accountId ?? "personal",
		},
	};
	publish();
}
Object.assign(window, {
	accountFixture: {
		quota: quotaFixture,
		failNextSwitch: () => {
			failSwitch = true;
		},
		usageUnavailable: (value: boolean) => {
			unavailable = value;
		},
		read: () => ({ state, forceReads }),
	},
});
export const electronTrpcClient = {
	...base,
	usage: {
		getClaudeProfile: { query: async () => profile },
		allLimits: { query: async () => [] },
	},
	agentAccounts: {
		list: {
			query: async () => ({
				accounts,
				activeId: "personal",
				sessions: [
					{
						key: "fixture",
						title: "Workspace improvements",
						accountId: state?.accountId ?? "personal",
					},
				],
			}),
		},
		codexUsage: {
			query: async ({ id, force }: { id: string; force?: boolean }) => {
				if (force) forceReads++;
				const label = accounts.find((account) => account.id === id)?.label;
				if (unavailable && id === "work")
					return {
						id,
						label,
						ready: true,
						limits: null,
						updatedAt: null,
						error: "Usage unavailable. Retry or check this account's sign-in.",
					};
				const percent = id === "personal" ? 100 : id === "school" ? 22 : 61;
				return {
					id,
					label,
					ready: true,
					limits: normalizeCodexLimits({
						rateLimits: {
							primary: {
								usedPercent: percent,
								windowDurationMins: 10080,
								resetsAt: 1793694600,
							},
							secondary: {
								usedPercent: id === "personal" ? 95 : 12,
								windowDurationMins: 300,
								resetsAt: 1793410200,
							},
						},
					}),
					updatedAt: Date.now(),
					error: null,
				};
			},
		},
		select: {
			mutate: async ({ id }: { id: string }) => {
				const previous = state;
				state = { ...state, status: "loading" };
				publish();
				await new Promise((resolve) => setTimeout(resolve, 180));
				if (failSwitch) {
					failSwitch = false;
					state = previous;
					publish();
					throw new Error(
						"This account could not connect. Your conversation is still on the original account.",
					);
				}
				state = {
					...state,
					accountId: id,
					status: "idle",
					error: null,
					usageLimit: undefined,
				};
				publish();
				return { ok: true, state: structuredClone(state) };
			},
		},
	},
	codexSession: {
		...base.codexSession,
		start: {
			mutate: async () => {
				state ??= {
					...(await base.codexSession.start.mutate({ key: "fixture" })),
					accountId: "personal",
				};
				return structuredClone(state);
			},
		},
		stream: {
			subscribe: (
				_input: unknown,
				handlers: { onData: (value: CodexSessionState) => void },
			) => {
				listeners.add(handlers.onData);
				return { unsubscribe: () => listeners.delete(handlers.onData) };
			},
		},
	},
};
const mutation = { mutate: () => {}, isPending: false };
const invalidation = { invalidate: async () => {}, refetch: async () => {} };
export const electronTrpc = {
	useUtils: () => ({
		usage: { getStats: invalidation, getStatusLine: invalidation },
	}),
	usage: {
		getStats: {
			useQuery: () => ({
				data: { models: [], perDay: [], quotas: [], totalTokens: 0 },
				isLoading: false,
				isFetching: false,
			}),
		},
		getClaudeProfile: { useQuery: () => ({ data: profile }) },
		getStatusLine: { useQuery: () => ({ data: { installed: true } }) },
		refreshLimits: { useMutation: () => mutation },
		installStatusLine: { useMutation: () => mutation },
		activeLimits: { useQuery: () => ({ data: undefined }) },
		limitsFor: { useQuery: () => ({ data: undefined }) },
	},
};
