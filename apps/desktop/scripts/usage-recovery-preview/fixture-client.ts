import type { UsageRecoveryState } from "../../src/shared/usage-recovery";

const listeners = new Set<() => void>();
let sequence = 0;
export const fixture = {
	unknown: false,
	calls: [] as Array<{ provider: string; action: string; input: unknown }>,
	recoveries: {} as Record<string, UsageRecoveryState | null>,
	reset() {
		this.calls = [];
		this.unknown = false;
		for (const key of ["claude", "codex"])
			this.recoveries[key] = {
				id: key + sequence++,
				message: "Usage limit reached",
				resetAt: Date.now() + 3_600_000,
				autoContinue: false,
				continuing: false,
			};
		this.emit();
	},
	emit() {
		for (const listener of listeners) listener();
	},
	listen(listener: () => void) {
		listeners.add(listener);
		return () => {
			listeners.delete(listener);
		};
	},
};
fixture.reset();
function api(provider: string) {
	return {
		continueAfterUsageLimit: {
			mutate: async (input: { key: string }) => {
				fixture.calls.push({ provider, action: "continue", input });
				fixture.recoveries[provider] = null;
				fixture.emit();
			},
		},
		autoContinueAfterUsageLimit: {
			mutate: async (input: { key: string; enabled: boolean }) => {
				fixture.calls.push({ provider, action: "auto", input });
				if (fixture.unknown && input.enabled)
					throw new Error(
						"The account hasn't reported a reset time yet. Check again in a moment.",
					);
				const state = fixture.recoveries[provider];
				if (state)
					fixture.recoveries[provider] = {
						...state,
						autoContinue: input.enabled,
					};
				fixture.emit();
			},
		},
	};
}
export const electronTrpcClient = {
	claudeSession: api("claude"),
	codexSession: api("codex"),
};
