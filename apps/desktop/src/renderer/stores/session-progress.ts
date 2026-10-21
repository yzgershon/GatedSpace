import type { SessionProgress } from "shared/session-progress";

const values = new Map<string, SessionProgress>();
const listeners = new Map<string, Set<() => void>>();
export const getSessionProgress = (paneId: string) => values.get(paneId);
export function publishSessionProgress(
	paneId: string,
	value?: SessionProgress,
) {
	if (JSON.stringify(values.get(paneId)) === JSON.stringify(value)) return;
	if (value) values.set(paneId, value);
	else values.delete(paneId);
	for (const listener of listeners.get(paneId) ?? []) listener();
}
export function subscribeSessionProgress(paneId: string, listener: () => void) {
	const set = listeners.get(paneId) ?? new Set();
	set.add(listener);
	listeners.set(paneId, set);
	return () => {
		set.delete(listener);
		if (!set.size) listeners.delete(paneId);
	};
}
