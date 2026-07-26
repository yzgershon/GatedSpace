import { describe, expect, test } from "bun:test";
import {
	parseResetLabel,
	parseUsageReport,
	toQuotaSnapshot,
} from "./usage-report";

/** Captured verbatim from a real `claude` one-shot `/usage`, not retyped. */
const REAL =
	"You are currently using your subscription to power your Claude Code usage\n\nCurrent session: 41% used · resets Jul 25, 5am (America/New_York)\nCurrent week (all models): 4% used · resets Jul 31, 10pm (America/New_York)\n\nWhat's contributing to your limits usage?\nApproximate, based on local sessions on this machine — does not include other devices or claude.ai. Behaviors are independent characteristics, not a breakdown.\n\nLast 24h · 879 requests · 16 sessions\n  94% of your usage was at >150k context\n  Top skills: /claude-api 1%\n  Top MCP servers: claude-in-chrome 1%\n\nLast 7d · 2916 requests · 36 sessions\n  92% of your usage was at >150k context\n  50% of your usage came from sessions active for 8+ hours\n  Top subagents: general-purpose 2%\n  Top MCP servers: claude-in-chrome 4%";

describe("parseUsageReport, against real captured output", () => {
	const report = parseUsageReport(REAL);

	test("takes the headline that says how usage is billed", () => {
		expect(report.headline).toBe(
			"You are currently using your subscription to power your Claude Code usage",
		);
	});

	test("reads the five-hour window the CLI calls a session", () => {
		expect(report.session).toEqual({
			usedPercent: 41,
			resetsAt: "Jul 25, 5am (America/New_York)",
		});
	});

	test("reads the weekly window despite the '(all models)' aside", () => {
		expect(report.week).toEqual({
			usedPercent: 4,
			resetsAt: "Jul 31, 10pm (America/New_York)",
		});
	});

	test("finds both activity blocks", () => {
		expect(report.activity.map((a) => a.label)).toEqual([
			"Last 24h",
			"Last 7d",
		]);
	});

	test("reads the counts off an activity heading", () => {
		expect(report.activity[0]).toMatchObject({
			requests: 879,
			sessions: 16,
		});
	});

	test("attaches indented characteristics to the block above them", () => {
		expect(report.activity[0]?.facts).toEqual([
			"94% of your usage was at >150k context",
			"Top skills: /claude-api 1%",
			"Top MCP servers: claude-in-chrome 1%",
		]);
		expect(report.activity[1]?.facts).toHaveLength(4);
	});

	test("keeps the explanatory prose out of the facts", () => {
		const allFacts = report.activity.flatMap((a) => a.facts);
		expect(allFacts.some((f) => f.startsWith("Approximate"))).toBe(false);
		expect(allFacts.some((f) => f.startsWith("What's contributing"))).toBe(
			false,
		);
	});

	test("keeps the raw text, so the dialog can always fall back to it", () => {
		expect(report.raw).toBe(REAL);
	});
});

describe("parseUsageReport, degrading", () => {
	test("thousands separators in the counts", () => {
		const report = parseUsageReport(
			"Last 7d · 12,345 requests · 1,002 sessions",
		);
		expect(report.activity[0]).toMatchObject({
			requests: 12345,
			sessions: 1002,
		});
	});

	test("a missing weekly line leaves it null rather than throwing", () => {
		const report = parseUsageReport(
			"Current session: 7% used · resets Jul 25, 5am (America/New_York)",
		);
		expect(report.session?.usedPercent).toBe(7);
		expect(report.week).toBeNull();
	});

	test("unrecognised output yields an empty report, not an exception", () => {
		const report = parseUsageReport("Something else entirely.");
		expect(report.session).toBeNull();
		expect(report.week).toBeNull();
		expect(report.activity).toEqual([]);
	});

	test("empty input is survivable", () => {
		expect(() => parseUsageReport("")).not.toThrow();
	});

	test("singular wording still parses", () => {
		const report = parseUsageReport("Last 24h · 1 request · 1 session");
		expect(report.activity[0]).toMatchObject({ requests: 1, sessions: 1 });
	});

	test("a window line ends the block above it", () => {
		const report = parseUsageReport(
			"Last 24h · 5 requests · 2 sessions\n  a fact\nCurrent week: 3% used · resets soon\n  stray",
		);
		expect(report.activity[0]?.facts).toEqual(["a fact"]);
	});
});

describe("parseResetLabel", () => {
	// Local time throughout: the phrase is in ZONE, and these tests declare the
	// machine to be in ZONE too, which is the case the parser accepts.
	const ZONE = "America/New_York";
	const at = (y: number, mo: number, d: number, h: number, mi = 0): number =>
		new Date(y, mo, d, h, mi, 0, 0).getTime();

	test("reads an on-the-hour phrase", () => {
		expect(
			parseResetLabel(
				"Jul 26, 5am (America/New_York)",
				at(2026, 6, 26, 0),
				ZONE,
			),
		).toBe(Math.floor(at(2026, 6, 26, 5) / 1000));
	});

	test("reads minutes when the CLI includes them", () => {
		expect(
			parseResetLabel(
				"Jul 26, 4:19am (America/New_York)",
				at(2026, 6, 26, 0),
				ZONE,
			),
		).toBe(Math.floor(at(2026, 6, 26, 4, 19) / 1000));
	});

	test("pm is afternoon, and 12pm is noon", () => {
		expect(
			parseResetLabel(
				"Jul 31, 10pm (America/New_York)",
				at(2026, 6, 31, 9),
				ZONE,
			),
		).toBe(Math.floor(at(2026, 6, 31, 22) / 1000));
		expect(
			parseResetLabel(
				"Jul 31, 12pm (America/New_York)",
				at(2026, 6, 31, 9),
				ZONE,
			),
		).toBe(Math.floor(at(2026, 6, 31, 12) / 1000));
	});

	test("12am is midnight, not noon", () => {
		expect(
			parseResetLabel(
				"Jul 31, 12am (America/New_York)",
				at(2026, 6, 30, 9),
				ZONE,
			),
		).toBe(Math.floor(at(2026, 6, 31, 0) / 1000));
	});

	test("the year is the one that lands nearest, across a New Year", () => {
		// Read on Jan 1st, "Dec 31" is yesterday — not eleven months out.
		expect(
			parseResetLabel(
				"Dec 31, 11pm (America/New_York)",
				at(2027, 0, 1, 1),
				ZONE,
			),
		).toBe(Math.floor(at(2026, 11, 31, 23) / 1000));
		// And the mirror: read on Dec 31st, "Jan 1" is tomorrow.
		expect(
			parseResetLabel(
				"Jan 1, 5am (America/New_York)",
				at(2026, 11, 31, 23),
				ZONE,
			),
		).toBe(Math.floor(at(2027, 0, 1, 5) / 1000));
	});

	test("a phrase from another zone is refused rather than guessed", () => {
		// Converting would need that zone's offset on that date. Returning null
		// makes the panel show the phrase; guessing would show a wrong countdown.
		expect(
			parseResetLabel("Jul 26, 5am (Europe/Berlin)", at(2026, 6, 26, 0), ZONE),
		).toBeNull();
	});

	test("vague or unparseable phrasing yields nothing", () => {
		expect(parseResetLabel("soon", Date.now(), ZONE)).toBeNull();
		expect(parseResetLabel("tomorrow", Date.now(), ZONE)).toBeNull();
		expect(
			parseResetLabel("Smurf 3, 5am (America/New_York)", 0, ZONE),
		).toBeNull();
	});
});

describe("toQuotaSnapshot", () => {
	const ZONE = "America/New_York";

	test("carries both percentages into the shape the panel stores", () => {
		const now = new Date(2026, 6, 25, 1).getTime();
		const snapshot = toQuotaSnapshot(parseUsageReport(REAL), now, ZONE);
		expect(snapshot).toEqual({
			five_hour: {
				used_percentage: 41,
				resets_label: "Jul 25, 5am (America/New_York)",
				resets_at: Math.floor(new Date(2026, 6, 25, 5).getTime() / 1000),
			},
			seven_day: {
				used_percentage: 4,
				resets_label: "Jul 31, 10pm (America/New_York)",
				resets_at: Math.floor(new Date(2026, 6, 31, 22).getTime() / 1000),
			},
			updatedAt: now,
		});
	});

	test("a report with no windows produces nothing to persist", () => {
		expect(toQuotaSnapshot(parseUsageReport("nope"), 1_000, ZONE)).toBeNull();
	});

	test("one window present still persists, with the other left null", () => {
		const report = parseUsageReport("Current week: 88% used · resets tomorrow");
		expect(toQuotaSnapshot(report, 5, ZONE)).toEqual({
			five_hour: null,
			seven_day: {
				used_percentage: 88,
				resets_label: "tomorrow",
				// Unresolvable phrasing writes an EXPLICIT null, so the merge in
				// persist() clears any epoch an earlier status-line write left
				// behind. A stale epoch is what renders as "resets now".
				resets_at: null,
			},
			updatedAt: 5,
		});
	});
});
