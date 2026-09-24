/**
 * Which sidebar panel the icon rail is showing.
 *
 * The rail selects a view; it doesn't navigate. That separation is what makes
 * the sidebar behave like an editor's activity bar rather than a menu: the
 * workspace you're working in doesn't change because you looked at your usage.
 *
 * Persisted, because which panel you left open is a preference, not session
 * state — reopening the app into a panel you weren't using is a small daily
 * annoyance.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";

export const SIDEBAR_PANELS = ["workspaces", "sessions"] as const;

export type SidebarPanel = (typeof SIDEBAR_PANELS)[number];

interface SidebarPanelState {
	activePanel: SidebarPanel;
	/** False hides the panel entirely, leaving just the rail. */
	panelOpen: boolean;
	/** Select a destination; collapsing belongs to the dedicated sidebar toggle. */
	selectPanel: (panel: SidebarPanel) => void;
	setPanelOpen: (open: boolean) => void;
}

export const useSidebarPanelStore = create<SidebarPanelState>()(
	persist(
		(set) => ({
			activePanel: "workspaces",
			panelOpen: true,
			selectPanel: (panel) => {
				set({ activePanel: panel, panelOpen: true });
			},
			setPanelOpen: (open) => set({ panelOpen: open }),
		}),
		{
			name: "sidebar-panel",
			// "usage" used to be a panel and is now a dialog on the rail; "testing"
			// was removed in 1.17.41. A stored value of either would select a branch
			// that no longer exists and render an empty column, so it falls back
			// rather than persisting a dead state.
			migrate: (persisted) => {
				const state = persisted as Partial<SidebarPanelState> | undefined;
				if (
					state?.activePanel &&
					!(SIDEBAR_PANELS as readonly string[]).includes(state.activePanel)
				) {
					return {
						...state,
						activePanel: "workspaces" as SidebarPanel,
						panelOpen: true,
					};
				}
				return { ...state, panelOpen: true } as SidebarPanelState;
			},
			// Restore sidebars hidden by the old repeated-click behavior once.
			version: 4,
		},
	),
);

export const useActiveSidebarPanel = () =>
	useSidebarPanelStore((state) => state.activePanel);
export const useSidebarPanelOpen = () =>
	useSidebarPanelStore((state) => state.panelOpen);
