/**
 * The sizing rules for an attached image.
 *
 * Worth testing rather than eyeballing: whatever gets sent is paid for on every
 * later turn of the conversation, and an image that looks fine on screen can
 * still be four times the pixels the model will ever use.
 */
import { describe, expect, test } from "bun:test";
import {
	attachmentName,
	formatBytes,
	MAX_IMAGE_EDGE,
	scaleFactor,
	targetSize,
} from "./composer-images";

describe("scaleFactor", () => {
	test("leaves an image already under the limit alone", () => {
		expect(scaleFactor(800, 600)).toBe(1);
	});

	test("never upscales — a small icon stays small", () => {
		expect(scaleFactor(64, 64)).toBe(1);
	});

	test("scales by the LONGEST edge, whichever it is", () => {
		expect(scaleFactor(3136, 100)).toBeCloseTo(0.5, 5);
		expect(scaleFactor(100, 3136)).toBeCloseTo(0.5, 5);
	});

	test("an image exactly at the limit is untouched", () => {
		expect(scaleFactor(MAX_IMAGE_EDGE, 400)).toBe(1);
	});

	test("a zero-sized image doesn't divide by zero", () => {
		expect(scaleFactor(0, 0)).toBe(1);
	});
});

describe("targetSize", () => {
	test("keeps the aspect ratio", () => {
		const size = targetSize(2560, 1440);
		expect(size.width).toBe(MAX_IMAGE_EDGE);
		// 1440 * (1568/2560) = 882
		expect(size.height).toBe(882);
	});

	test("a real screenshot lands on the long-edge cap", () => {
		expect(targetSize(2548, 1318).width).toBe(MAX_IMAGE_EDGE);
	});

	test("passes an under-limit image through unchanged", () => {
		expect(targetSize(1200, 800)).toEqual({ width: 1200, height: 800 });
	});

	test("a thin strip never rounds away to zero pixels", () => {
		// 1 * (1568/5000) rounds to 0 if you floor it — that's an invalid canvas.
		const size = targetSize(5000, 1);
		expect(size.height).toBeGreaterThanOrEqual(1);
		expect(size.width).toBe(MAX_IMAGE_EDGE);
	});
});

describe("formatBytes", () => {
	test("reads as MB past a megabyte", () => {
		expect(formatBytes(2_500_000)).toBe("2.4 MB");
	});

	test("reads as KB in between", () => {
		expect(formatBytes(2048)).toBe("2 KB");
	});

	test("stays in bytes when tiny", () => {
		expect(formatBytes(75)).toBe("75 B");
	});
});

describe("attachmentName", () => {
	test("keeps a real filename", () => {
		expect(attachmentName({ name: "screenshot.png" } as File, 0)).toBe(
			"screenshot.png",
		);
	});

	test("invents one for an unnamed paste, numbered from 1", () => {
		expect(attachmentName({ name: "" } as File, 0)).toBe("pasted-1.png");
		expect(attachmentName({ name: "   " } as File, 2)).toBe("pasted-3.png");
	});
});
