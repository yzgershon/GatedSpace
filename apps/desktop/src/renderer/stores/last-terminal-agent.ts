/**
 * The agent whose terminal you opened last.
 *
 * Remembered so the common case costs one click instead of hover-then-click. It
 * only ever PROMOTES an entry beside Terminal — the submenu keeps every agent in
 * a fixed order, so the list never reshuffles under the cursor mid-reach, which
 * is the usual way "smart" menus become slower than dumb ones.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";

interface LastTerminalAgentState {
	lastAgentId: string | null;
	setLastAgentId: (id: string) => void;
}

export const useLastTerminalAgent = create<LastTerminalAgentState>()(
	persist(
		(set) => ({
			lastAgentId: null,
			setLastAgentId: (id) => set({ lastAgentId: id }),
		}),
		{ name: "last-terminal-agent" },
	),
);
