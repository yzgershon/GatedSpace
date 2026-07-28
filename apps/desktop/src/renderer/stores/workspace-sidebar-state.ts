import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";

export const DEFAULT_WORKSPACE_SIDEBAR_WIDTH = 280;
/**
 * Collapsed width — EXACTLY the icon rail's own width (`w-12` = 48px).
 *
 * It used to be 52, which left a 4px strip of panel background and its border
 * showing beside the rail: a sliver that looked like a rendering fault rather
 * than a state. Any change to the rail's width has to change this with it, so
 * they are documented as one number in two places rather than two numbers that
 * happen to be close.
 */
export const COLLAPSED_WORKSPACE_SIDEBAR_WIDTH = 48;
const MIN_WORKSPACE_SIDEBAR_WIDTH = 220;
export const MAX_WORKSPACE_SIDEBAR_WIDTH = 400;

// Threshold for snapping to collapsed state
const COLLAPSE_THRESHOLD = 120;

interface WorkspaceSidebarState {
	isOpen: boolean;
	width: number;
	lastExpandedWidth: number;
	// Use string[] instead of Set<string> for JSON serialization with Zustand persist
	collapsedProjectIds: string[];
	isResizing: boolean;

	toggleOpen: () => void;
	setOpen: (open: boolean) => void;
	setWidth: (width: number) => void;
	setIsResizing: (isResizing: boolean) => void;
	toggleProjectCollapsed: (projectId: string) => void;
	isProjectCollapsed: (projectId: string) => boolean;
	toggleCollapsed: () => void;
	isCollapsed: () => boolean;
}

export const useWorkspaceSidebarStore = create<WorkspaceSidebarState>()(
	devtools(
		persist(
			(set, get) => ({
				isOpen: true,
				width: DEFAULT_WORKSPACE_SIDEBAR_WIDTH,
				lastExpandedWidth: DEFAULT_WORKSPACE_SIDEBAR_WIDTH,
				collapsedProjectIds: [],
				isResizing: false,

				toggleOpen: () => {
					const { isOpen, lastExpandedWidth } = get();
					if (isOpen) {
						set({ isOpen: false, width: 0 });
					} else {
						set({
							isOpen: true,
							width: lastExpandedWidth,
						});
					}
				},

				setOpen: (open) => {
					const { lastExpandedWidth } = get();
					set({
						isOpen: open,
						width: open ? lastExpandedWidth : 0,
					});
				},

				setWidth: (width) => {
					// Snap to collapsed if below threshold (never allow closing completely via drag)
					if (width < COLLAPSE_THRESHOLD) {
						set({
							width: COLLAPSED_WORKSPACE_SIDEBAR_WIDTH,
							isOpen: true,
						});
						return;
					}

					// Clamp to expanded range
					const clampedWidth = Math.max(
						MIN_WORKSPACE_SIDEBAR_WIDTH,
						Math.min(MAX_WORKSPACE_SIDEBAR_WIDTH, width),
					);

					set({
						width: clampedWidth,
						lastExpandedWidth: clampedWidth,
						isOpen: true,
					});
				},

				setIsResizing: (isResizing) => {
					set({ isResizing });
				},

				toggleProjectCollapsed: (projectId) => {
					set((state) => ({
						collapsedProjectIds: state.collapsedProjectIds.includes(projectId)
							? state.collapsedProjectIds.filter((id) => id !== projectId)
							: [...state.collapsedProjectIds, projectId],
					}));
				},

				isProjectCollapsed: (projectId) => {
					return get().collapsedProjectIds.includes(projectId);
				},

				toggleCollapsed: () => {
					const { width, lastExpandedWidth } = get();
					const isCurrentlyCollapsed =
						width === COLLAPSED_WORKSPACE_SIDEBAR_WIDTH;

					if (isCurrentlyCollapsed) {
						set({ width: lastExpandedWidth });
					} else {
						set({ width: COLLAPSED_WORKSPACE_SIDEBAR_WIDTH });
					}
				},

				isCollapsed: () => {
					return get().width === COLLAPSED_WORKSPACE_SIDEBAR_WIDTH;
				},
			}),
			{
				name: "workspace-sidebar-store",
				version: 2,
				// Exclude ephemeral state from persistence
				partialize: (state) => ({
					isOpen: state.isOpen,
					width: state.width,
					lastExpandedWidth: state.lastExpandedWidth,
					collapsedProjectIds: state.collapsedProjectIds,
					// isResizing intentionally excluded - ephemeral UI state
				}),
			},
		),
		{ name: "WorkspaceSidebarStore" },
	),
);
