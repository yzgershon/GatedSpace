import { useSyncExternalStore } from "react";
import { normalizeCodexLimits } from "shared/codex-session/controls";

let windowMinutes = 10080;
const listeners = new Set<() => void>();
Object.assign(window, {
	setUsageWindow: (minutes: number) => {
		windowMinutes = minutes;
		for (const listener of listeners) listener();
	},
});
function useCodexUsage() {
	const minutes = useSyncExternalStore(
		(listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		() => windowMinutes,
	);
	return {
		isPending: false,
		data: normalizeCodexLimits({
			rateLimits: {
				primary: minutes
					? {
							usedPercent: 25,
							windowDurationMins: minutes,
							resetsAt: 1790474931,
						}
					: null,
			},
		}),
	};
}
const claude = {
	useQuery: () => ({
		isPending: false,
		data: {
			label: "Claude",
			fiveHourPercent: 54,
			weeklyPercent: 18,
			fiveHourResets: null,
		},
	}),
};
export const electronTrpc = {
	usage: { activeLimits: claude, limitsFor: claude },
	codexSession: { limits: { useQuery: useCodexUsage } },
};
