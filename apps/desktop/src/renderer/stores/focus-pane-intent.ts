/**
 * "Bring this pane forward", asked for from somewhere that cannot reach the
 * pane store.
 *
 * The sidebar is mounted at the dashboard layout level, while the v2 pane store
 * is created per route by `useV2WorkspacePaneLayout` and passed down as a prop.
 * Calling that hook from the sidebar would build a SECOND, empty store rather
 * than read the live one. An intent store is how the rest of this codebase
 * crosses that gap — see `run-command-intent`, `right-sidebar-toggle-intent`.
 *
 * `tick` rather than a plain id, so clicking the SAME pane twice still fires.
 * Clicking a session, scrolling away in the transcript, then clicking it again
 * to jump back is the common case, and a value-only store would swallow the
 * second click.
 */
import { create } from "zustand";

interface FocusPaneIntentState {
	paneId: string | null;
	tick: number;
	request: (paneId: string) => void;
	clear: () => void;
}

export const useFocusPaneIntent = create<FocusPaneIntentState>((set) => ({
	paneId: null,
	tick: 0,
	request: (paneId) => set((state) => ({ paneId, tick: state.tick + 1 })),
	clear: () => set({ paneId: null }),
}));
