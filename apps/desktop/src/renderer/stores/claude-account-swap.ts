/**
 * "Open the account picker", asked for from somewhere that cannot render it.
 *
 * `/swap` is accepted in three places — the session composer, a terminal's
 * keystroke stream, and the command palette — and none of them owns a dialog.
 * The same intent-store pattern the rest of this codebase uses for that gap
 * (`run-command-intent`, `focus-pane-intent`) applies here: the caller records
 * what it wants swapped, and one host mounted in the dashboard layout shows the
 * picker.
 *
 * One store, one picker, one dialog. That is the point of it — the account was
 * previously changeable from a dropdown submenu, a phone page and a config
 * file, each with its own idea of what "active" meant.
 */
import { create } from "zustand";

export type SwapTarget =
	/**
	 * Swap the account a LIVE session pane is running on. The pane restarts
	 * under the new account with `--resume`, so the conversation carries over.
	 */
	| { kind: "session"; paneKey: string; paneTitle?: string }
	/**
	 * Swap the account everything launched from here on uses. A running process
	 * keeps the account it was spawned with — a pty's environment is fixed at
	 * spawn and there is no honest way around that, so the picker says so
	 * rather than implying a switch that did not happen.
	 */
	| {
			kind: "default";
			from?: "terminal" | "palette" | "menu";
			/**
			 * What was typed after `/swap`. When it names exactly one account the
			 * host applies it without opening anything — typing the name IS the
			 * choice, and making someone confirm a decision they already spelled
			 * out is the kind of friction that sends people back to the menu.
			 */
			query?: string;
	  };

interface ClaudeAccountSwapState {
	target: SwapTarget | null;
	/**
	 * Bumped on every request so asking for the SAME target twice reopens the
	 * picker. A value-only store would swallow the second ask, which is the
	 * common case here: `/swap`, change your mind, `/swap` again.
	 */
	tick: number;
	open: (target: SwapTarget) => void;
	close: () => void;
}

export const useClaudeAccountSwap = create<ClaudeAccountSwapState>((set) => ({
	target: null,
	tick: 0,
	open: (target) => set((state) => ({ target, tick: state.tick + 1 })),
	close: () => set({ target: null }),
}));

/** Open the picker from outside React. */
export function requestAccountSwap(target: SwapTarget): void {
	useClaudeAccountSwap.getState().open(target);
}
