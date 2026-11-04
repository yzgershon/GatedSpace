import { useSyncExternalStore } from "react";
import { normalizeCodexLimits } from "shared/codex-session/controls";

let windowMinutes = 10080;
const listeners = new Set<() => void>();
Object.assign(window, {
	setUsageWindow: (minutes: number) => {
		windowMinutes = minutes;
		window.dispatchEvent(new Event("codex-fixture-usage"));
		for (const listener of listeners) listener();
	},
});
export function getFixtureCodexLimits() {
	return normalizeCodexLimits({
		rateLimits: {
			primary: windowMinutes
				? {
						usedPercent: 25,
						windowDurationMins: windowMinutes,
						resetsAt: 1790474931,
					}
				: null,
		},
	});
}
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
