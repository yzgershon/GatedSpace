/**
 * A renderer-side snapshot of ranked shell history.
 *
 * The command palette builds its list synchronously — providers are plain
 * objects with a `provide(context)` call, not hooks — so the data has to be
 * sitting in memory by the time it runs. This holds the last result and
 * refreshes it in the background.
 *
 * Stale-while-revalidate on purpose: showing the previous ranking for a few
 * milliseconds is better than showing an empty palette while a file is read,
 * and the ranking barely moves between two opens anyway.
 */
import type { RankedCommand } from "@superset/shared/command-history";
import { electronTrpcClient } from "renderer/lib/trpc-client";

let snapshot: readonly RankedCommand[] = [];
let inFlight: Promise<void> | null = null;
const listeners = new Set<() => void>();

export function getCommandHistorySnapshot(): readonly RankedCommand[] {
	return snapshot;
}

export function subscribeToCommandHistory(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

/**
 * Refresh in the background. Safe to call on every palette open — overlapping
 * calls share one request, and an identical result does not notify, so this
 * cannot drive a render loop through the provider registry.
 */
export function refreshCommandHistory(cwd?: string | null): Promise<void> {
	if (inFlight) return inFlight;
	inFlight = electronTrpcClient.terminal.commandHistory
		.query({ cwd: cwd ?? null, limit: 50 })
		.then((rows) => {
			if (!hasChanged(snapshot, rows)) return;
			snapshot = rows;
			for (const listener of listeners) listener();
		})
		.catch(() => {
			// A missing or unreadable history file is not worth surfacing: the
			// palette simply has no history section, which is also what a fresh
			// install looks like.
		})
		.finally(() => {
			inFlight = null;
		});
	return inFlight;
}

function hasChanged(
	previous: readonly RankedCommand[],
	next: readonly RankedCommand[],
): boolean {
	if (previous.length !== next.length) return true;
	for (let index = 0; index < next.length; index++) {
		// Compare the two fields the palette actually renders. Score drifts on
		// every call as time passes, so comparing it would report a change every
		// refresh and re-register the provider forever.
		if (previous[index]?.command !== next[index]?.command) return true;
		if (previous[index]?.lastSucceeded !== next[index]?.lastSucceeded) {
			return true;
		}
	}
	return false;
}

/** Test seam. */
export function resetCommandHistorySnapshot(): void {
	snapshot = [];
	inFlight = null;
	listeners.clear();
}
