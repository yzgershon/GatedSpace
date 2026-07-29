import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readProfileLimits } from "../claude-session/usage-refresh";
import { MOBILE_BRIDGE_APP_JS } from "./client-app";

/**
 * The phone renders the usage screen from whatever `/api/usage` sends, and
 * nothing typechecks the phone. It shipped reading `sessionPct`, `weekPct` and
 * `opusWeekPct` — names that exist nowhere on the server — so every account
 * reported "no usage recorded yet" while the desktop showed real percentages,
 * with no error anywhere to suggest why.
 *
 * This asserts the two sides agree on the names, by asking the server for a
 * real answer rather than by restating the names in a second place.
 */

function limitsFromFixture() {
	const configDir = mkdtempSync(join(tmpdir(), "gs-usage-"));
	mkdirSync(join(configDir, "cache"), { recursive: true });
	writeFileSync(
		join(configDir, "cache", "rate-limits.json"),
		JSON.stringify({
			five_hour: { used_percentage: 42, resets_label: "3pm" },
			seven_day: { used_percentage: 71, resets_label: "Tue" },
			updatedAt: 1_700_000_000_000,
		}),
	);
	return readProfileLimits(configDir);
}

describe("the usage contract", () => {
	const limits = limitsFromFixture();

	it("reads the CLI's own file shape", () => {
		// Guards the fixture itself: if this drifts, the test below would pass
		// against a shape the CLI never writes.
		expect(limits.fiveHourPercent).toBe(42);
		expect(limits.weeklyPercent).toBe(71);
		expect(limits.fiveHourResets).toBe("3pm");
		expect(limits.weeklyResets).toBe("Tue");
	});

	it("has the phone reading every field that carries a number", () => {
		const numeric = Object.entries(limits)
			.filter(([, value]) => typeof value === "number")
			.map(([key]) => key);
		// updatedAt is a number the phone deliberately ignores.
		const shown = numeric.filter((key) => key !== "updatedAt");
		expect(shown.length).toBeGreaterThan(0);
		for (const key of shown) {
			expect(MOBILE_BRIDGE_APP_JS).toContain(`limits.${key}`);
		}
	});

	it("has the phone reading the reset labels too", () => {
		for (const key of ["fiveHourResets", "weeklyResets"]) {
			expect(MOBILE_BRIDGE_APP_JS).toContain(`limits.${key}`);
		}
	});

	it("no longer reads names the server never sends", () => {
		// Property ACCESS, not the bare word: the comment explaining this bug
		// names the old fields, and matching those would fail on the fix's own
		// documentation.
		for (const invented of ["sessionPct", "weekPct", "opusWeekPct"]) {
			expect(MOBILE_BRIDGE_APP_JS).not.toContain(`limits.${invented}`);
		}
	});
});
