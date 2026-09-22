import { create } from "zustand";

export interface FocusedSession {
	paneId: string;
	provider: "claude" | "codex";
}
export const useFocusedSession = create<{
	session: FocusedSession | null;
	set: (session: FocusedSession | null) => void;
}>((set) => ({
	session: null,
	set: (session) =>
		set((previous) =>
			previous.session?.paneId === session?.paneId &&
			previous.session?.provider === session?.provider
				? previous
				: { session },
		),
}));

export function sessionFromPane(pane?: {
	id: string;
	kind: string;
	data: unknown;
}): FocusedSession | null {
	if (!pane) return null;
	const data = pane.data as { provider?: string; agentId?: string };
	const provider =
		pane.kind === "session"
			? (data.provider ?? "claude")
			: pane.kind === "terminal"
				? data.agentId
				: undefined;
	return provider === "claude" || provider === "codex"
		? { paneId: pane.id, provider }
		: null;
}
