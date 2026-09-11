/**
 * Dragging a tab in the rail, on pointer events alone.
 *
 * THERE USED TO BE TWO DRAG SYSTEMS ON THE SAME ELEMENT, and every reported
 * symptom came out of the fight between them. The chip was an HTML5 drag source
 * (react-dnd, for dropping a tab onto a pane) AND carried a `pointerdown`
 * reorder handler. Press and move, and Chromium starts the native drag, which
 * suppresses pointer events — so the reorder never saw a single move and the
 * tab "didn't drag", while the native drag ran with an EMPTY drag image and
 * therefore showed nothing at all. Over the rail itself there was no target
 * accepting a tab, so the cursor sat on the no-drop glyph, which is the crossed
 * red circle.
 *
 * Then the release: the pane under the cursor DID accept it, so the tab's panes
 * were merged into whatever happened to be underneath — "it appears wherever my
 * cursor is" — with nothing on screen having offered that.
 *
 * And the part that forced a restart: the reorder's cleanup was bound to
 * `pointerup`, which never arrives once a native drag has taken over. The
 * window listeners leaked, `reorderRef` stayed populated so later pointer moves
 * kept reordering tabs, and `isReordering` stayed true forever — and that flag
 * gates an `onClickCapture` that swallows clicks, so the tab could never be
 * activated again until the component remounted. Quitting the app was the only
 * way to remount it.
 *
 * So: ONE system. Pointer capture guarantees the moves and the release land on
 * the element that took the gesture, `lostpointercapture` guarantees teardown
 * even if the browser revokes it, and nothing here is subject to the top bar's
 * Electron drag region the way HTML5 drag is.
 */

import type { WorkspaceStore } from "@superset/panes";
import { useCallback, useEffect, useRef, useState } from "react";
import type { StoreApi } from "zustand/vanilla";
import type { PaneViewerData } from "../../types";
import {
	type ChipBox,
	clampDragOffset,
	computeSplitPosition,
	computeTargetIndex,
	computeTilt,
	isPastRail,
	type SplitPosition,
} from "./tabRailDrag";

/** The chip is the drag handle, except where something says otherwise. */
export const NO_DRAG_ATTRIBUTE = "data-rail-nodrag";

/** Movement before a press becomes a drag, so a click is still a click. */
const SLOP_PX = 5;

export interface PaneDropTarget {
	paneId: string;
	position: SplitPosition;
	rect: { left: number; top: number; width: number; height: number };
}

export interface RailDragState {
	tabId: string;
	fromIndex: number;
	toIndex: number;
	/** How far the lifted chip has moved from its slot, in px. */
	offset: number;
	tilt: number;
	draggedWidth: number;
	paneTarget: PaneDropTarget | null;
}

interface Session {
	tabId: string;
	fromIndex: number;
	startX: number;
	startY: number;
	pointerId: number;
	node: HTMLElement;
	boxes: ChipBox[];
	railBox: ChipBox;
	railBottom: number;
	lastX: number;
	moved: boolean;
	/** Latest pointer position, read by the frame loop rather than acted on. */
	x: number;
	y: number;
	/** Where the lean is heading, and where it currently is. */
	tiltTarget: number;
	tilt: number;
	frame: number | null;
}

/*
 * The lean is animated on a FRAME LOOP, not on pointer events.
 *
 * Tilt is derived from speed, so an event-driven version can only update it
 * when the pointer moves — and the one moment it most needs to change is when
 * the pointer STOPS, which produces no event at all. The chip would hold its
 * last lean indefinitely, which reads as a rendering fault rather than motion.
 *
 * The loop also decouples the render rate from the input rate: a mouse
 * reporting at 1000Hz would otherwise drive a thousand renders a second.
 */
/** How fast the lean chases its target. */
const TILT_EASE = 0.25;
/** How fast the target falls back to upright while the pointer coasts. */
const TILT_DECAY = 0.82;
/** Below this the lean is over; snapping to 0 stops a pointless frame loop. */
const TILT_EPSILON = 0.01;

export interface TabRailDrag {
	state: RailDragState | null;
	start: (event: React.PointerEvent<HTMLElement>, tabId: string) => void;
	/** True while a click on this tab should be swallowed as drag fallout. */
	shouldSwallowClick: (tabId: string) => boolean;
}

export function useTabRailDrag({
	store,
	railRef,
}: {
	store: StoreApi<WorkspaceStore<PaneViewerData>>;
	railRef: React.RefObject<HTMLDivElement | null>;
}): TabRailDrag {
	const [state, setState] = useState<RailDragState | null>(null);
	const sessionRef = useRef<Session | null>(null);
	const swallowRef = useRef<string | null>(null);
	/*
	 * The FLIP hand-off, held across two frames.
	 *
	 * On release the store reorders, so the chip's slot changes underneath it in
	 * the same commit. Animating `transform` alone would transition from an
	 * offset measured against the OLD slot to zero at the NEW one, while the
	 * layout jumps instantly — a visible snap at the exact moment the eye is
	 * following the tab. Instead the chip is pinned to where it was last SEEN,
	 * then released to zero on the next frame, so it travels the short distance
	 * into its new slot.
	 */
	const settleRef = useRef<{ node: HTMLElement; visualLeft: number } | null>(
		null,
	);

	const finish = useCallback(() => {
		const session = sessionRef.current;
		if (session?.frame !== null && session?.frame !== undefined) {
			cancelAnimationFrame(session.frame);
		}
		sessionRef.current = null;
		setState(null);
	}, []);

	/** One frame of the drag: read the pointer, ease the lean, publish. */
	const tick = useCallback(() => {
		const session = sessionRef.current;
		if (!session) return;
		session.frame = null;

		const dragged = session.boxes[session.fromIndex];
		if (!dragged) return;

		session.tiltTarget *= TILT_DECAY;
		session.tilt += (session.tiltTarget - session.tilt) * TILT_EASE;
		if (Math.abs(session.tilt) < TILT_EPSILON) session.tilt = 0;

		const paneTarget = isPastRail(session.y, session.railBottom)
			? resolvePaneTarget(session.x, session.y, session.tabId, store)
			: null;

		setState({
			tabId: session.tabId,
			fromIndex: session.fromIndex,
			toIndex: paneTarget
				? session.fromIndex
				: computeTargetIndex(session.x, session.boxes, session.fromIndex),
			offset: clampDragOffset(
				session.x - session.startX,
				dragged,
				session.railBox,
			),
			// Upright over a pane: the chip has stopped being a thing in a row and
			// the overlay is carrying the message, so a lean would be noise.
			tilt: paneTarget ? 0 : session.tilt,
			draggedWidth: dragged.width,
			paneTarget,
		});

		// Keep running while the lean is still settling, even with no input.
		if (session.tilt !== 0) session.frame = requestAnimationFrame(tick);
	}, [store]);

	const schedule = useCallback(() => {
		const session = sessionRef.current;
		if (!session || session.frame !== null) return;
		session.frame = requestAnimationFrame(tick);
	}, [tick]);

	const start = useCallback(
		(event: React.PointerEvent<HTMLElement>, tabId: string) => {
			if (event.button !== 0) return;
			if (sessionRef.current) return;
			const target = event.target as HTMLElement | null;
			if (target?.closest(`[${NO_DRAG_ATTRIBUTE}]`)) return;

			const rail = railRef.current;
			const node = event.currentTarget;
			if (!rail) return;

			const chips = Array.from(
				rail.querySelectorAll<HTMLElement>("[data-rail-tab]"),
			);
			const fromIndex = chips.indexOf(node);
			if (fromIndex < 0) return;

			const railRect = rail.getBoundingClientRect();
			sessionRef.current = {
				tabId,
				fromIndex,
				startX: event.clientX,
				startY: event.clientY,
				pointerId: event.pointerId,
				node,
				boxes: chips.map((chip) => {
					const rect = chip.getBoundingClientRect();
					return { left: rect.left, width: rect.width };
				}),
				railBox: { left: railRect.left, width: railRect.width },
				railBottom: railRect.bottom,
				lastX: event.clientX,
				moved: false,
				x: event.clientX,
				y: event.clientY,
				tiltTarget: 0,
				tilt: 0,
				frame: null,
			};
		},
		[railRef],
	);

	useEffect(() => {
		const onMove = (event: PointerEvent) => {
			const session = sessionRef.current;
			if (!session || event.pointerId !== session.pointerId) return;

			if (
				!session.moved &&
				Math.abs(event.clientX - session.startX) < SLOP_PX &&
				Math.abs(event.clientY - session.startY) < SLOP_PX
			) {
				return;
			}
			if (!session.moved) {
				session.moved = true;
				/*
				 * Capture AFTER the slop, not on pointerdown. Capturing straight away
				 * would redirect every move to the chip before we know a drag was
				 * meant, and a plain click would arrive having passed through a
				 * capture it never needed.
				 */
				try {
					session.node.setPointerCapture(session.pointerId);
				} catch {
					// Capture is an optimisation, not a requirement — the window
					// listeners below already see every move. A browser that refuses
					// it degrades to slightly worse tracking, not a stuck drag.
				}
			}

			session.tiltTarget = computeTilt(event.clientX - session.lastX);
			session.lastX = event.clientX;
			session.x = event.clientX;
			session.y = event.clientY;
			schedule();
		};

		const onUp = (event: PointerEvent) => {
			const session = sessionRef.current;
			if (!session || event.pointerId !== session.pointerId) return;
			try {
				session.node.releasePointerCapture(session.pointerId);
			} catch {}

			if (!session.moved) {
				finish();
				return;
			}

			// The click that follows this release belongs to the drag, not to the
			// tab. Cleared by the component once it has swallowed one.
			swallowRef.current = session.tabId;

			const rect = session.node.getBoundingClientRect();
			settleRef.current = { node: session.node, visualLeft: rect.left };

			const paneTarget = isPastRail(event.clientY, session.railBottom)
				? resolvePaneTarget(event.clientX, event.clientY, session.tabId, store)
				: null;

			if (paneTarget) {
				store.getState().moveTabToSplit({
					sourceTabId: session.tabId,
					targetPaneId: paneTarget.paneId,
					position: paneTarget.position,
				});
			} else {
				const toIndex = computeTargetIndex(
					event.clientX,
					session.boxes,
					session.fromIndex,
				);
				if (toIndex !== session.fromIndex) {
					store.getState().reorderTab({ tabId: session.tabId, toIndex });
				}
			}
			finish();
		};

		const onCancel = (event: PointerEvent) => {
			const session = sessionRef.current;
			if (!session || event.pointerId !== session.pointerId) return;
			if (session.moved) swallowRef.current = session.tabId;
			finish();
		};

		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			const session = sessionRef.current;
			if (!session) return;
			event.preventDefault();
			if (session.moved) swallowRef.current = session.tabId;
			try {
				session.node.releasePointerCapture(session.pointerId);
			} catch {}
			finish();
		};

		window.addEventListener("pointermove", onMove);
		window.addEventListener("pointerup", onUp);
		window.addEventListener("pointercancel", onCancel);
		// The browser can revoke capture on its own (the element being removed,
		// a context menu). Without this the session would outlive its gesture,
		// which is the leak that used to require restarting the app.
		window.addEventListener("lostpointercapture", onCancel);
		window.addEventListener("keydown", onKeyDown);
		return () => {
			window.removeEventListener("pointermove", onMove);
			window.removeEventListener("pointerup", onUp);
			window.removeEventListener("pointercancel", onCancel);
			window.removeEventListener("lostpointercapture", onCancel);
			window.removeEventListener("keydown", onKeyDown);
		};
	}, [store, finish, schedule]);

	// Second half of the FLIP: the reorder has committed and the chip is now in
	// its new slot, so pin it back to where it was last seen and let it travel.
	useEffect(() => {
		const settle = settleRef.current;
		if (!settle || state) return;
		settleRef.current = null;
		const { node, visualLeft } = settle;
		const delta = visualLeft - node.getBoundingClientRect().left;
		if (Math.abs(delta) < 0.5) return;
		/*
		 * `animate()` rather than toggling inline styles.
		 *
		 * The chip's transition is set by React through the `style` prop, as
		 * longhands. Writing `node.style.transition` to suppress the first frame
		 * sets the SHORTHAND, which resets every longhand with it — so the chip
		 * would come out of its settle with no transition at all until the next
		 * render, and the next hover would jump. A Web Animation runs over the
		 * top of the styles and tidies itself up.
		 */
		node.animate(
			[
				{ transform: `translate3d(${delta}px, 0, 0)` },
				{ transform: "translate3d(0, 0, 0)" },
			],
			{ duration: 260, easing: "cubic-bezier(0.2, 0.9, 0.25, 1.05)" },
		);
	});

	const shouldSwallowClick = useCallback((tabId: string) => {
		if (swallowRef.current !== tabId) return false;
		swallowRef.current = null;
		return true;
	}, []);

	return { state, start, shouldSwallowClick };
}

/**
 * The pane under the pointer, if dropping there would do anything.
 *
 * Refuses a pane the dragged tab already owns: merging a tab into itself
 * rearranges nothing, and offering it invites a gesture that looks broken.
 */
function resolvePaneTarget(
	x: number,
	y: number,
	tabId: string,
	store: StoreApi<WorkspaceStore<PaneViewerData>>,
): PaneDropTarget | null {
	const element = document
		.elementFromPoint(x, y)
		?.closest<HTMLElement>("[data-pane-id]");
	const paneId = element?.dataset.paneId;
	if (!element || !paneId) return null;

	const owner = store.getState().tabs.find((tab) => paneId in tab.panes);
	if (!owner || owner.id === tabId) return null;

	const domRect = element.getBoundingClientRect();
	const rect = {
		left: domRect.left,
		top: domRect.top,
		width: domRect.width,
		height: domRect.height,
	};
	return { paneId, position: computeSplitPosition(x, y, rect), rect };
}
