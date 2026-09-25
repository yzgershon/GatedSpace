import { describe, expect, test } from "bun:test";
import { previewLayout } from "./preview-layout";

describe("native browser preview layout", () => {
	test("fits desktop without cropping either dimension", () => {
		const layout = previewLayout(
			{ left: 100, top: 50, width: 640, height: 300 },
			[],
			"desktop",
			"portrait",
		);
		expect(layout.scale).toBe(0.375);
		expect(layout.width).toBe(480);
		expect(layout.height).toBe(300);
		expect(layout.left).toBe(180);
		expect(layout.top).toBe(50);
	});
	test("rotates S24 and retains its aspect ratio in narrow panels", () => {
		const rect = { left: 0, top: 0, width: 240, height: 500 };
		const portrait = previewLayout(rect, [], "galaxy-s24", "portrait");
		const landscape = previewLayout(rect, [], "galaxy-s24", "landscape");
		expect(portrait.width / portrait.height).toBeCloseTo(360 / 780);
		expect(landscape.width / landscape.height).toBeCloseTo(780 / 360);
		expect(portrait.height).toBeCloseTo(500);
		expect(landscape.width).toBe(240);
	});
	test("intersects every clipping ancestor during layout transitions", () => {
		const layout = previewLayout(
			{ left: 100, top: 100, width: 500, height: 500 },
			[
				{ left: 120, top: 90, width: 400, height: 450 },
				{ left: 0, top: 150, width: 1000, height: 200 },
			],
			"responsive",
			"portrait",
		);
		expect(layout.clipPath).toBe("inset(50px 80px 250px 20px)");
	});
	test("collapsed and out of view native surfaces stay hidden", () => {
		expect(
			previewLayout(
				{ left: 0, top: 0, width: 0, height: 0 },
				[],
				"galaxy-s24",
				"portrait",
			).visible,
		).toBe(false);
		expect(
			previewLayout(
				{ left: 100, top: 100, width: 400, height: 400 },
				[{ left: 0, top: 0, width: 50, height: 50 }],
				"responsive",
				"portrait",
			).visible,
		).toBe(false);
	});
});
