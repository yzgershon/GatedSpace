/**
 * Independent zoom for the main area and the left sidebar.
 *
 * The window already has a zoom — Electron's `webContents.setZoomLevel`, saved
 * in window state — but it scales EVERYTHING, sidebar included. That is the one
 * thing this is for: shrinking the session without shrinking the workspace list,
 * or the other way round.
 *
 * So this is CSS `zoom` on the two regions instead. `zoom` rather than
 * `transform: scale()` because zoom participates in layout — a scaled element
 * still occupies its scaled size, so flex still does the right thing and there
 * is no overflow to chase. Transform would paint smaller while reserving the
 * original box.
 *
 * Applied in the dashboard layout to the top bar, the outlet, and the sidebar
 * SEPARATELY rather than to a shared ancestor: the sidebar renders inside the
 * main column in some layouts, and zooming a common parent would multiply the
 * two scales together.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Below ~70% the sidebar's labels start clipping rather than shrinking, and
 * above ~130% the top bar's controls begin to collide. Both are the point where
 * the layout stops being merely small or large and starts being broken.
 */
export const MIN_UI_SCALE = 0.7;
export const MAX_UI_SCALE = 1.3;
export const UI_SCALE_STEP = 0.05;
export const DEFAULT_UI_SCALE = 1;

export function clampUiScale(value: number): number {
	if (!Number.isFinite(value)) return DEFAULT_UI_SCALE;
	return Math.min(MAX_UI_SCALE, Math.max(MIN_UI_SCALE, value));
}

/** 0.85 -> "85%". Rounded because floats land on 0.8500000000000001. */
export function formatUiScale(value: number): string {
	return `${Math.round(value * 100)}%`;
}

interface UiScaleState {
	/** Top bar, tabs, and the session itself. */
	mainScale: number;
	/** The workspace list on the left. */
	sidebarScale: number;
	setMainScale: (value: number) => void;
	setSidebarScale: (value: number) => void;
	/** Both back to 100%. */
	reset: () => void;
}

export const useUiScaleStore = create<UiScaleState>()(
	persist(
		(set) => ({
			mainScale: DEFAULT_UI_SCALE,
			sidebarScale: DEFAULT_UI_SCALE,
			setMainScale: (value) => set({ mainScale: clampUiScale(value) }),
			setSidebarScale: (value) => set({ sidebarScale: clampUiScale(value) }),
			reset: () =>
				set({ mainScale: DEFAULT_UI_SCALE, sidebarScale: DEFAULT_UI_SCALE }),
		}),
		{
			name: "gatedspace:ui-scale",
			// Clamp on the way back in: a hand-edited or older stored value must not
			// be able to render the app at a size it cannot be used at, which would
			// leave no way to reach the setting that fixes it.
			merge: (persisted, current) => {
				const saved = persisted as Partial<UiScaleState> | undefined;
				return {
					...current,
					mainScale: clampUiScale(saved?.mainScale ?? DEFAULT_UI_SCALE),
					sidebarScale: clampUiScale(saved?.sidebarScale ?? DEFAULT_UI_SCALE),
				};
			},
		},
	),
);

/**
 * `zoom` is omitted entirely at 100% so the default render path is untouched —
 * a zoom of exactly 1 still creates a containing block in Chromium, and that
 * has caught out position:fixed children before.
 */
export function zoomStyle(scale: number): React.CSSProperties | undefined {
	return scale === DEFAULT_UI_SCALE ? undefined : { zoom: scale };
}
