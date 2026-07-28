/**
 * "Send this browser pane's page to a Claude session", asked for from the
 * browser pane's own menu.
 *
 * The browser pane knows which page to capture but not which session should
 * receive it — session panes live in the workspace store, which arrives as a
 * prop rather than a singleton. Same gap the run-command intent crosses, and
 * crossed the same way: the menu records what it wants, and a hook inside the
 * workspace tree resolves the target and does the work.
 *
 * `tick` as well as the id, so capturing the SAME pane twice in a row fires
 * twice. Taking a second screenshot after changing the page is the common
 * case, and a value-only store would swallow it.
 */
import { create } from "zustand";

interface SendPageToSessionIntentState {
	browserPaneId: string | null;
	tick: number;
	request: (browserPaneId: string) => void;
	clear: () => void;
}

export const useSendPageToSessionIntent = create<SendPageToSessionIntentState>(
	(set) => ({
		browserPaneId: null,
		tick: 0,
		request: (browserPaneId) =>
			set((state) => ({ browserPaneId, tick: state.tick + 1 })),
		clear: () => set({ browserPaneId: null }),
	}),
);
