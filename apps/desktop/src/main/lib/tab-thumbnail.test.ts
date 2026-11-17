import { expect, test } from "bun:test";
import { thumbnailRect } from "./tab-thumbnail";

test("thumbnail capture respects page zoom and clips to this app window", () => {
	expect(
		thumbnailRect({ x: 20, y: 80, width: 900, height: 700 }, 1.25, {
			width: 1000,
			height: 800,
		}),
	).toEqual({ x: 25, y: 100, width: 975, height: 700 });
	expect(
		thumbnailRect({ x: -10, y: 20, width: 200, height: 100 }, 1, {
			width: 300,
			height: 200,
		}),
	).toEqual({ x: 0, y: 20, width: 190, height: 100 });
	expect(
		thumbnailRect({ x: 500, y: 20, width: 200, height: 100 }, 1, {
			width: 300,
			height: 200,
		}),
	).toBeNull();
});
