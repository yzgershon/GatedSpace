/**
 * "Run this shell command in the focused terminal", asked for from somewhere
 * that cannot reach a terminal.
 *
 * The command palette is mounted app-wide, while the active terminal lives in
 * the v2 workspace store — which is passed down as a prop, not a singleton. An
 * intent store is how the rest of this codebase crosses that gap (see
 * `right-sidebar-toggle-intent`, `delete-workspace-intent`): the palette
 * records what it wants, and a hook inside the workspace tree does it.
 *
 * `tick` rather than a plain string, so asking for the SAME command twice in a
 * row still fires. Re-running the last thing you ran is the common case here,
 * and a value-only store would swallow it.
 */
import { create } from "zustand";

interface RunCommandIntentState {
	command: string | null;
	tick: number;
	request: (command: string) => void;
	clear: () => void;
}

export const useRunCommandIntent = create<RunCommandIntentState>((set) => ({
	command: null,
	tick: 0,
	request: (command) => set((state) => ({ command, tick: state.tick + 1 })),
	clear: () => set({ command: null }),
}));
