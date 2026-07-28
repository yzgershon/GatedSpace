/**
 * "Let me click an element in this browser pane and send it to a session",
 * asked for from the browser pane's own menu.
 *
 * Same shape and same reason as `send-page-to-session-intent`: the browser pane
 * knows which page to pick from but not which session should receive the
 * result, because session panes live in the workspace store, which arrives as a
 * prop rather than a singleton. The menu records what it wants; a hook inside
 * the workspace tree resolves the target and does the work.
 *
 * `tick` as well as the id, so picking twice from the same pane fires twice.
 * Picking a second element is the common case, not the edge case.
 */
import { create } from "zustand";

interface PickElementIntentState {
	browserPaneId: string | null;
	tick: number;
	request: (browserPaneId: string) => void;
	clear: () => void;
}

export const usePickElementIntent = create<PickElementIntentState>((set) => ({
	browserPaneId: null,
	tick: 0,
	request: (browserPaneId) =>
		set((state) => ({ browserPaneId, tick: state.tick + 1 })),
	clear: () => set({ browserPaneId: null }),
}));
