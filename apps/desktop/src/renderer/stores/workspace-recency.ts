import { create } from "zustand";
import { persist } from "zustand/middleware";

interface WorkspaceRecencyState {
	recentFirst: boolean;
	openedAt: Record<string, number>;
	setRecentFirst: (enabled: boolean) => void;
	markOpened: (workspaceId: string) => void;
}

/** Visits only: background agent activity must never reorder the workspace list. */
export const useWorkspaceRecency = create<WorkspaceRecencyState>()(
	persist(
		(set) => ({
			recentFirst: true,
			openedAt: {},
			setRecentFirst: (recentFirst) => set({ recentFirst }),
			markOpened: (workspaceId) =>
				set((state) => ({
					openedAt: Object.fromEntries(
						Object.entries({ ...state.openedAt, [workspaceId]: Date.now() })
							.sort((a, b) => b[1] - a[1])
							.slice(0, 500),
					),
				})),
		}),
		{ name: "gatedspace-workspace-recency", version: 1 },
	),
);
