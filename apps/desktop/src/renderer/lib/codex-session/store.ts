import { toast } from "@superset/ui/sonner";
import { electronTrpcClient } from "renderer/lib/trpc-client";
import type { CodexSessionState } from "shared/codex-session/types";

const states = new Map<string, CodexSessionState>();
const listeners = new Map<string, Set<() => void>>();
export function getCodexSession(key: string) {
	return states.get(key);
}
export function publishCodexSession(state: CodexSessionState) {
	states.set(state.key, state);
	for (const listener of listeners.get(state.key) ?? []) listener();
}
export function subscribeCodexSession(key: string, listener: () => void) {
	let set = listeners.get(key);
	if (!set) {
		set = new Set();
		listeners.set(key, set);
	}
	set.add(listener);
	return () => {
		set.delete(listener);
		if (!set.size) listeners.delete(key);
	};
}
export async function disposeCodexSession(key: string) {
	try {
		await electronTrpcClient.codexSession.close.mutate({ key });
	} catch (error) {
		toast.error("Could not disconnect Codex", {
			description: error instanceof Error ? error.message : String(error),
		});
	}
	states.delete(key);
	for (const listener of listeners.get(key) ?? []) listener();
}
