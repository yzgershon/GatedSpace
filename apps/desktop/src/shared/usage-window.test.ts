/**
 * The bug being pinned down: the usage panel showed "100% used" and "resets
 * now" side by side. The percentage was from the previous five-hour window and
 * the countdown was the clock reaching a timestamp nobody re-checked, so the
 * app claimed you were out of quota at the exact moment you were not.
 */
import { describe, expect, test } from "bun:test";
import { resolveUsageWindow } from "./usage-window";

const NOW = Date.UTC(2026, 6, 30, 3, 48, 0); // 2026-07-30T03:48:00Z
const sec = (ms: number) => Math.floor(ms / 1000);

describe("resolveUsageWindow", () => {
	test("zeroes a window whose reset moment has passed", () => {
		// The exact reported state: 100% left over from the window before.
		const resolved = resolveUsageWindow(
			{
				used_percentage: 100,
				resets_at: sec(NOW) - 60,
				resets_label: "Jul 30, 10pm (America/New_York)",
			},
			NOW,
		);
		expect(resolved?.usedPercent).toBe(0);
		expect(resolved?.rolledOver).toBe(true);
	});

	test("zeroes at the reset instant itself, not a second later", () => {
		// This instant is precisely when the old display read "resets now" next
		// to a full bar.
		const resolved = resolveUsageWindow(
			{ used_percentage: 53, resets_at: sec(NOW) },
			NOW,
		);
		expect(resolved?.usedPercent).toBe(0);
		expect(resolved?.rolledOver).toBe(true);
	});

	test("reports no reset time once rolled over, rather than projecting one", () => {
		// The next window starts when you next send something, not on a fixed
		// schedule — so adding five hours would be a confident guess, which is the
		// failure mode being fixed. The formatter renders nothing for null.
		const resolved = resolveUsageWindow(
			{
				used_percentage: 100,
				resets_at: sec(NOW) - 3600,
				resets_label: "Jul 30, 10pm (America/New_York)",
			},
			NOW,
		);
		expect(resolved?.resetsAt).toBeNull();
		expect(resolved?.resetsLabel).toBeNull();
	});

	test("leaves a live window completely alone", () => {
		const resetsAt = sec(NOW) + 3600;
		const resolved = resolveUsageWindow(
			{
				used_percentage: 53,
				resets_at: resetsAt,
				resets_label: "Jul 30, 10pm (America/New_York)",
			},
			NOW,
		);
		expect(resolved).toEqual({
			usedPercent: 53,
			resetsAt,
			resetsLabel: "Jul 30, 10pm (America/New_York)",
			rolledOver: false,
		});
	});

	test("keeps a percentage that has no reset moment at all", () => {
		// Unknown reset is not an elapsed reset. Zeroing here would erase a real
		// number on the strength of a missing field.
		const resolved = resolveUsageWindow({ used_percentage: 41 }, NOW);
		expect(resolved?.usedPercent).toBe(41);
		expect(resolved?.rolledOver).toBe(false);
	});

	test("rolls over a window stale by several periods", () => {
		const resolved = resolveUsageWindow(
			{ used_percentage: 87, resets_at: sec(NOW) - 86_400 },
			NOW,
		);
		expect(resolved?.usedPercent).toBe(0);
		expect(resolved?.rolledOver).toBe(true);
	});

	test("returns null when there is nothing to show", () => {
		expect(resolveUsageWindow(null, NOW)).toBeNull();
		expect(resolveUsageWindow(undefined, NOW)).toBeNull();
		expect(resolveUsageWindow({}, NOW)).toBeNull();
	});
});
