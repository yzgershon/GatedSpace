import { describe, expect, test } from "bun:test";
import { WARN_AT_PERCENT, worstWindow } from "./UsageBanner";

describe("worstWindow", () => {
	test("stays quiet below the threshold — an always-on banner stops being read", () => {
		expect(worstWindow({ fiveHourPercent: 40, weeklyPercent: 12 })).toBeNull();
	});

	test("warns about whichever window is further along", () => {
		expect(worstWindow({ fiveHourPercent: 95, weeklyPercent: 10 })).toEqual({
			name: "5-hour limit",
			percent: 95,
		});
		expect(worstWindow({ fiveHourPercent: 10, weeklyPercent: 88 })).toEqual({
			name: "weekly limit",
			percent: 88,
		});
	});

	test("weekly wins a tie — it takes days to come back, not hours", () => {
		expect(worstWindow({ fiveHourPercent: 90, weeklyPercent: 90 })?.name).toBe(
			"weekly limit",
		);
	});

	test("fires exactly at the threshold, not one past it", () => {
		expect(
			worstWindow({ fiveHourPercent: WARN_AT_PERCENT, weeklyPercent: null }),
		).not.toBeNull();
		expect(
			worstWindow({
				fiveHourPercent: WARN_AT_PERCENT - 1,
				weeklyPercent: null,
			}),
		).toBeNull();
	});

	test("a missing window is unknown, not zero", () => {
		// Null must not read as "0% used" and quietly outrank a real 85%.
		expect(worstWindow({ fiveHourPercent: null, weeklyPercent: 85 })).toEqual({
			name: "weekly limit",
			percent: 85,
		});
	});

	test("no data at all says nothing", () => {
		expect(
			worstWindow({ fiveHourPercent: null, weeklyPercent: null }),
		).toBeNull();
		expect(worstWindow(null)).toBeNull();
		expect(worstWindow(undefined)).toBeNull();
	});

	test("spent windows still report their real number", () => {
		expect(
			worstWindow({ fiveHourPercent: 100, weeklyPercent: 10 })?.percent,
		).toBe(100);
	});
});
