import { describe, expect, test } from "bun:test";
import {
	type ChipBox,
	clampDragOffset,
	computeSlideOffset,
	computeSplitPosition,
	computeTargetIndex,
	computeTilt,
	isPastRail,
	overlayRect,
	PANE_DROP_THRESHOLD_PX,
} from "./tabRailDrag";

/** Four chips of unequal width — an active tab shows its title, the rest don't. */
const BOXES: ChipBox[] = [
	{ left: 100, width: 40 }, // midpoint 120
	{ left: 140, width: 120 }, // midpoint 200  (the active one)
	{ left: 260, width: 40 }, // midpoint 280
	{ left: 300, width: 40 }, // midpoint 320
];

describe("computeTargetIndex", () => {
	test("holds the original slot until a midpoint is crossed", () => {
		expect(computeTargetIndex(150, BOXES, 0)).toBe(0);
		expect(computeTargetIndex(199, BOXES, 0)).toBe(0);
	});

	test("claims a slot once the pointer passes its midpoint", () => {
		expect(computeTargetIndex(201, BOXES, 0)).toBe(1);
		expect(computeTargetIndex(281, BOXES, 0)).toBe(2);
		expect(computeTargetIndex(321, BOXES, 0)).toBe(3);
	});

	test("works leftward too", () => {
		expect(computeTargetIndex(119, BOXES, 3)).toBe(0);
		expect(computeTargetIndex(121, BOXES, 3)).toBe(1);
	});

	test("uses each chip's own midpoint, not a shared width", () => {
		// The wide chip at index 1 is only claimed past 200, not past 160 —
		// assuming a uniform width drops the tab in the wrong slot.
		expect(computeTargetIndex(170, BOXES, 0)).toBe(0);
		expect(computeTargetIndex(201, BOXES, 0)).toBe(1);
	});

	test("a pointer far off either end pins to the end slot", () => {
		expect(computeTargetIndex(-500, BOXES, 2)).toBe(0);
		expect(computeTargetIndex(5000, BOXES, 1)).toBe(3);
	});
});

describe("computeSlideOffset", () => {
	test("moving right slides the chips it passes to the left", () => {
		expect(computeSlideOffset(0, 0, 2, 40)).toBe(0);
		expect(computeSlideOffset(1, 0, 2, 40)).toBe(-40);
		expect(computeSlideOffset(2, 0, 2, 40)).toBe(-40);
		expect(computeSlideOffset(3, 0, 2, 40)).toBe(0);
	});

	test("moving left slides them right", () => {
		expect(computeSlideOffset(0, 3, 1, 40)).toBe(0);
		expect(computeSlideOffset(1, 3, 1, 40)).toBe(40);
		expect(computeSlideOffset(2, 3, 1, 40)).toBe(40);
		expect(computeSlideOffset(3, 3, 1, 40)).toBe(0);
	});

	test("nothing moves when the slot has not changed", () => {
		for (let i = 0; i < 4; i++) expect(computeSlideOffset(i, 2, 2, 40)).toBe(0);
	});
});

describe("clampDragOffset", () => {
	const rail: ChipBox = { left: 90, width: 260 }; // 90..350
	test("passes through an offset that stays inside", () => {
		expect(clampDragOffset(30, { left: 100, width: 40 }, rail)).toBe(30);
	});
	test("stops at the left edge", () => {
		expect(clampDragOffset(-500, { left: 100, width: 40 }, rail)).toBe(-10);
	});
	test("stops at the right edge", () => {
		expect(clampDragOffset(500, { left: 100, width: 40 }, rail)).toBe(210);
	});
});

describe("computeTilt", () => {
	test("is zero when the pointer is not moving", () => {
		expect(computeTilt(0)).toBe(0);
	});
	test("leans into the direction of travel", () => {
		expect(computeTilt(10)).toBeGreaterThan(0);
		expect(computeTilt(-10)).toBeLessThan(0);
	});
	test("caps, so a flick cannot spin the chip", () => {
		expect(computeTilt(10_000)).toBe(2.5);
		expect(computeTilt(-10_000)).toBe(-2.5);
	});
});

describe("isPastRail", () => {
	test("an ordinary sideways drag never leaves reorder mode", () => {
		expect(isPastRail(60, 64)).toBe(false);
		expect(isPastRail(64 + PANE_DROP_THRESHOLD_PX, 64)).toBe(false);
	});
	test("a deliberate pull downward does", () => {
		expect(isPastRail(64 + PANE_DROP_THRESHOLD_PX + 1, 64)).toBe(true);
	});
});

describe("computeSplitPosition", () => {
	const rect = { left: 0, top: 0, width: 400, height: 200 };
	test("picks the half the pointer is furthest into", () => {
		expect(computeSplitPosition(20, 100, rect)).toBe("left");
		expect(computeSplitPosition(380, 100, rect)).toBe("right");
		expect(computeSplitPosition(200, 10, rect)).toBe("top");
		expect(computeSplitPosition(200, 190, rect)).toBe("bottom");
	});
});

describe("overlayRect", () => {
	const rect = { left: 100, top: 50, width: 400, height: 200 };
	test("covers exactly the half that will be taken", () => {
		expect(overlayRect(rect, "left")).toEqual({
			left: 100,
			top: 50,
			width: 200,
			height: 200,
		});
		expect(overlayRect(rect, "bottom")).toEqual({
			left: 100,
			top: 150,
			width: 400,
			height: 100,
		});
	});
});
