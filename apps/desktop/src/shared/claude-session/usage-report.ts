/**
 * Parse the CLI's `/usage` reply into something renderable.
 *
 * `/usage` is answered LOCALLY — a probe against the real binary came back
 * `turns=0 cost=0` — so asking for it costs nothing and touches no API. That's
 * what makes it safe to refresh automatically, and it's the only local source of
 * true subscription percentages for an account that hasn't rendered a status
 * line (a headless session pane never does, which is why an account used only
 * through the pane reads 0%).
 *
 * The grammar below was written against verbatim captured output, not from
 * memory. Every field is optional: the wording differs for API-key auth, and a
 * missing line should degrade to "unknown" rather than throw away the reply.
 */

export interface UsageWindow {
	usedPercent: number;
	/** Verbatim, e.g. "Jul 25, 5am (America/New_York)" — already localised. */
	resetsAt: string;
}

export interface UsageActivity {
	/** "Last 24h" / "Last 7d", verbatim. */
	label: string;
	requests: number;
	sessions: number;
	/** The indented characteristics under the heading, in order. */
	facts: string[];
}

export interface UsageReport {
	/** The opening line, which states how usage is being billed. */
	headline: string;
	/** The rolling five-hour window the CLI calls "Current session". */
	session: UsageWindow | null;
	/** The seven-day window. */
	week: UsageWindow | null;
	activity: UsageActivity[];
	/** Kept so the dialog can fall back to showing exactly what the CLI said. */
	raw: string;
}

/** "Current session: 41% used · resets Jul 25, 5am (America/New_York)" */
const WINDOW_RE =
	/^Current (session|week)[^:]*:\s*(\d+)%\s*used\s*·\s*resets\s+(.+)$/i;

/** "Last 24h · 879 requests · 16 sessions" */
const ACTIVITY_RE =
	/^(Last\s+\S+)\s*·\s*([\d,]+)\s+requests?\s*·\s*([\d,]+)\s+sessions?/i;

function toInt(value: string): number {
	return Number.parseInt(value.replace(/,/g, ""), 10);
}

export function parseUsageReport(text: string): UsageReport {
	const lines = text.split("\n");
	const report: UsageReport = {
		headline: "",
		session: null,
		week: null,
		activity: [],
		raw: text,
	};

	let current: UsageActivity | null = null;

	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed) continue;

		if (!report.headline && /^You are currently using/i.test(trimmed)) {
			report.headline = trimmed;
			continue;
		}

		const window = WINDOW_RE.exec(trimmed);
		if (window) {
			const parsed: UsageWindow = {
				usedPercent: toInt(window[2] ?? "0"),
				resetsAt: (window[3] ?? "").trim(),
			};
			if (window[1]?.toLowerCase() === "session") report.session = parsed;
			else report.week = parsed;
			// A window line ends whatever activity block preceded it.
			current = null;
			continue;
		}

		const activity = ACTIVITY_RE.exec(trimmed);
		if (activity) {
			current = {
				label: (activity[1] ?? "").trim(),
				requests: toInt(activity[2] ?? "0"),
				sessions: toInt(activity[3] ?? "0"),
				facts: [],
			};
			report.activity.push(current);
			continue;
		}

		// Indentation is what marks a characteristic as belonging to the block
		// above it. Un-indented prose between blocks is the explanatory blurb,
		// which the dialog states in its own words.
		if (current && /^\s{2,}/.test(line)) {
			current.facts.push(trimmed);
			continue;
		}

		// Anything else closes the current block rather than absorbing prose into it.
		current = null;
	}

	return report;
}

/** "Jul 26, 4:19am (America/New_York)" — month, day, hour, opt. minute, zone. */
const RESET_LABEL_RE =
	/^([A-Za-z]{3})\s+(\d{1,2}),\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*\(([^)]+)\)\s*$/i;

const MONTHS = [
	"jan",
	"feb",
	"mar",
	"apr",
	"may",
	"jun",
	"jul",
	"aug",
	"sep",
	"oct",
	"nov",
	"dec",
];

/**
 * Turn a reset phrase into an epoch, or null when it can't be done exactly.
 *
 * This used to be refused outright, on the grounds that deriving a timestamp
 * from a localised phrase is a guess. Refusing had a worse failure mode: the
 * stored `resets_at` then stayed at whatever the status line last wrote, and a
 * countdown reading from a stale epoch renders "resets now" against a
 * percentage from hours ago. Wrong either way — but the stale one looks
 * authoritative.
 *
 * It isn't a guess when the phrase's zone IS this machine's zone, which is the
 * normal case: the CLI localises to the machine. Then the only missing piece is
 * the year, and the right year is simply the one that lands nearest now (which
 * is also what makes a New Year's Eve reset resolve forwards, not 12 months
 * back). When the zones differ, this returns null rather than inventing an
 * offset, and the caller shows the phrase instead of a countdown.
 */
export function parseResetLabel(
	label: string,
	now: number,
	timeZone: string,
): number | null {
	const match = RESET_LABEL_RE.exec(label.trim());
	if (!match) return null;

	const [, monthName, dayText, hourText, minuteText, meridiem, zone] = match;
	if (!zone || zone.trim() !== timeZone) return null;

	const month = MONTHS.indexOf((monthName ?? "").toLowerCase());
	if (month < 0) return null;

	const day = Number(dayText);
	const minute = minuteText ? Number(minuteText) : 0;
	let hour = Number(hourText) % 12;
	if ((meridiem ?? "").toLowerCase() === "pm") hour += 12;

	// The year is the only thing the phrase omits. Try the neighbours and keep
	// whichever lands closest to now, so a December reset read in January
	// resolves backwards rather than a year forwards.
	const thisYear = new Date(now).getFullYear();
	let best: number | null = null;
	for (const year of [thisYear - 1, thisYear, thisYear + 1]) {
		const candidate = new Date(year, month, day, hour, minute, 0, 0).getTime();
		if (Number.isNaN(candidate)) continue;
		if (best === null || Math.abs(candidate - now) < Math.abs(best - now)) {
			best = candidate;
		}
	}
	return best === null ? null : Math.floor(best / 1000);
}

/**
 * Everything the usage panel needs, in the shape it already stores per profile
 * (see `readClaudeQuota` in main/lib/usage-stats.ts).
 *
 * `resets_at` is included, and is explicitly null when the phrase couldn't be
 * resolved exactly — null so it OVERWRITES a stale epoch from an earlier write
 * rather than letting the merge preserve it. A countdown that admits it doesn't
 * know beats one that's confidently hours wrong.
 */
export function toQuotaSnapshot(
	report: UsageReport,
	now: number,
	timeZone: string = Intl.DateTimeFormat().resolvedOptions().timeZone,
): {
	five_hour: QuotaSnapshotWindow | null;
	seven_day: QuotaSnapshotWindow | null;
	updatedAt: number;
} | null {
	if (!report.session && !report.week) return null;
	const window = (source: UsageWindow): QuotaSnapshotWindow => ({
		used_percentage: source.usedPercent,
		// The localised phrase, kept verbatim — it's what gets shown when the
		// epoch below can't be resolved.
		resets_label: source.resetsAt,
		resets_at: parseResetLabel(source.resetsAt, now, timeZone),
	});
	return {
		five_hour: report.session ? window(report.session) : null,
		seven_day: report.week ? window(report.week) : null,
		updatedAt: now,
	};
}

export interface QuotaSnapshotWindow {
	used_percentage: number;
	resets_label: string;
	resets_at: number | null;
}
