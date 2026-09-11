/**
 * The arithmetic behind dragging a tab in the rail.
 *
 * Split out from the component because all of it is pure and none of it is
 * obvious: which slot the pointer is currently over, how far each OTHER chip
 * has to move to open the gap, and whether the pointer has left the rail far
 * enough to mean "merge into that pane" instead of "reorder".
 */

/** A chip's box, measured once when the drag starts. */
export interface ChipBox {
	left: number;
	width: number;
}

/**
 * Which slot the dragged tab would land in.
 *
 * Measured against the ORIGINAL boxes, not live ones. The chips are being
 * translated as the gap opens, so reading their current rectangles mid-drag
 * asks where a chip has animated to rather than which slot it belongs to — the
 * target then chases its own animation and the order flickers between two
 * values under a stationary pointer.
 *
 * A slot is claimed once the pointer passes its MIDPOINT, which is what makes
 * the swap happen where the eye expects rather than at the moment two chips
 * merely touch.
 */
export function computeTargetIndex(
	pointerX: number,
	boxes: readonly ChipBox[],
	fromIndex: number,
): number {
	let target = fromIndex;
	for (let i = 0; i < boxes.length; i++) {
		if (i === fromIndex) continue;
		const box = boxes[i];
		if (!box) continue;
		const midpoint = box.left + box.width / 2;
		if (i < fromIndex && pointerX < midpoint) target = Math.min(target, i);
		if (i > fromIndex && pointerX > midpoint) target = Math.max(target, i);
	}
	return target;
}

/**
 * How far chip `index` slides to open the gap, in px. Positive is rightward.
 *
 * Only the chips BETWEEN the two slots move, and they all move by the width of
 * the hole the dragged chip left behind — so the row stays evenly spaced
 * instead of bunching. Everything outside that span holds still, which is what
 * makes the movement readable rather than a general shuffle.
 */
export function computeSlideOffset(
	index: number,
	fromIndex: number,
	toIndex: number,
	draggedWidth: number,
): number {
	if (index === fromIndex) return 0;
	if (fromIndex < toIndex && index > fromIndex && index <= toIndex) {
		return -draggedWidth;
	}
	if (fromIndex > toIndex && index >= toIndex && index < fromIndex) {
		return draggedWidth;
	}
	return 0;
}

/**
 * Keeps the lifted chip inside the rail.
 *
 * Without this it is dragged straight out of its own container and reads as a
 * loose object with no relationship to the row it came from — and on the way
 * out it is clipped by the top bar, so it half-disappears.
 */
export function clampDragOffset(
	rawOffset: number,
	dragged: ChipBox,
	rail: ChipBox,
): number {
	const min = rail.left - dragged.left;
	const max = rail.left + rail.width - (dragged.left + dragged.width);
	return Math.min(Math.max(rawOffset, min), max);
}

/**
 * The lean the chip takes on, in degrees.
 *
 * Derived from the pointer's SPEED, not its displacement — that is the whole
 * difference between something that feels physical and something that is merely
 * translated. It leans into a flick, and comes back upright the moment the
 * pointer settles, even if the chip is still far from home.
 *
 * Capped hard: past a couple of degrees a rectangle with a 10px radius stops
 * reading as tilted and starts reading as misrendered.
 */
export function computeTilt(velocity: number): number {
	const MAX_DEGREES = 2.5;
	const DEGREES_PER_PX_PER_EVENT = 0.09;
	const tilt = velocity * DEGREES_PER_PX_PER_EVENT;
	return Math.min(MAX_DEGREES, Math.max(-MAX_DEGREES, tilt));
}

/**
 * How far below the rail the pointer must go before a drag stops being a
 * reorder and becomes a drop onto a pane.
 *
 * The gesture that merges two groups and the gesture that reorders them are
 * the same gesture for the first few pixels, so the split between them has to
 * be somewhere. Putting it well outside the rail means an ordinary sideways
 * drag can never trip it — which is the accident being fixed: releasing a tab
 * over a pane used to merge it in silently, with nothing on screen having
 * said so.
 */
export const PANE_DROP_THRESHOLD_PX = 28;

export function isPastRail(pointerY: number, railBottom: number): boolean {
	return pointerY > railBottom + PANE_DROP_THRESHOLD_PX;
}

export type SplitPosition = "top" | "bottom" | "left" | "right";

/**
 * Which half of a pane the pointer is in.
 *
 * The same quadrant rule `Pane` applies to a react-dnd hover, so a tab dropped
 * from the rail splits exactly where a tab dropped from anywhere else does.
 */
export function computeSplitPosition(
	pointerX: number,
	pointerY: number,
	rect: { left: number; top: number; width: number; height: number },
): SplitPosition {
	const dx = pointerX - (rect.left + rect.width / 2);
	const dy = pointerY - (rect.top + rect.height / 2);
	if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? "right" : "left";
	return dy > 0 ? "bottom" : "top";
}

/** The rectangle the drop overlay paints, given the pane box and the half. */
export function overlayRect(
	rect: { left: number; top: number; width: number; height: number },
	position: SplitPosition,
): { left: number; top: number; width: number; height: number } {
	const half = {
		left: {
			left: rect.left,
			top: rect.top,
			width: rect.width / 2,
			height: rect.height,
		},
		right: {
			left: rect.left + rect.width / 2,
			top: rect.top,
			width: rect.width / 2,
			height: rect.height,
		},
		top: {
			left: rect.left,
			top: rect.top,
			width: rect.width,
			height: rect.height / 2,
		},
		bottom: {
			left: rect.left,
			top: rect.top + rect.height / 2,
			width: rect.width,
			height: rect.height / 2,
		},
	} as const;
	return half[position];
}
