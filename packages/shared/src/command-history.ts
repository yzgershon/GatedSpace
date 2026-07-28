/**
 * The command-history file format, and how to rank what's in it.
 *
 * The row shape is a contract between two packages that never call each other:
 * the pty-daemon writes it, the desktop reads it. It lives here so neither owns
 * the other's format.
 *
 * Ranking is "frecency" — frequency weighted by recency — with two adjustments
 * that matter more than the formula:
 *
 *   - Repetition is counted in DISTINCT DAYS, not raw runs. Something typed
 *     forty times while debugging one afternoon is not a habit; something typed
 *     once a day for a fortnight is. Raw counts rank the afternoon's flailing
 *     above the fortnight's routine.
 *   - Interrupt exits count as SUCCESS. A dev server ended with Ctrl-C exits
 *     130, and a process stopped by a supervisor exits 143. Treating those as
 *     failures would demote exactly the long-running commands people re-run
 *     most.
 */

/** Bump when the row shape changes; readers skip versions they don't know. */
export const COMMAND_HISTORY_VERSION = 1;

export interface CommandHistoryRow {
	v: number;
	sessionId: string;
	/** The command as typed. */
	command: string;
	/** Where it ran, when the shell reported one. */
	cwd: string | null;
	exitCode: number;
	/** Epoch ms at execution start. */
	startedAt: number;
	durationMs: number;
}

/**
 * Exit codes that mean "this worked".
 *
 * 130 is SIGINT (Ctrl-C) and 143 is SIGTERM. Both are how a long-running
 * process is normally ENDED rather than how it fails, so counting them as
 * failures would push `npm run dev` and `docker compose up` down the ranking
 * precisely because they are used constantly.
 */
const SUCCESS_EXIT_CODES = new Set([0, 130, 143]);

export function isSuccessExit(exitCode: number): boolean {
	return SUCCESS_EXIT_CODES.has(exitCode);
}

/** Parse one JSONL line, or null when it isn't a row this version understands. */
export function parseCommandHistoryLine(
	line: string,
): CommandHistoryRow | null {
	const trimmed = line.trim();
	if (!trimmed) return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(trimmed);
	} catch {
		// A torn final line is expected — the writer appends while we read.
		return null;
	}
	if (!parsed || typeof parsed !== "object") return null;
	const row = parsed as Partial<CommandHistoryRow>;
	if (row.v !== COMMAND_HISTORY_VERSION) return null;
	if (typeof row.command !== "string" || !row.command) return null;
	if (typeof row.exitCode !== "number") return null;
	if (typeof row.startedAt !== "number") return null;
	return {
		v: row.v,
		sessionId: typeof row.sessionId === "string" ? row.sessionId : "",
		command: row.command,
		cwd: typeof row.cwd === "string" ? row.cwd : null,
		exitCode: row.exitCode,
		startedAt: row.startedAt,
		durationMs: typeof row.durationMs === "number" ? row.durationMs : 0,
	};
}

export function parseCommandHistory(contents: string): CommandHistoryRow[] {
	const rows: CommandHistoryRow[] = [];
	for (const line of contents.split("\n")) {
		const row = parseCommandHistoryLine(line);
		if (row) rows.push(row);
	}
	return rows;
}

export interface RankedCommand {
	command: string;
	/** How many distinct days this was run on. */
	days: number;
	/** Total runs, for display. */
	runs: number;
	lastRunAt: number;
	/** True when the most recent run succeeded. */
	lastSucceeded: boolean;
	score: number;
}

export interface RankOptions {
	/** Bias toward commands previously run here. */
	cwd?: string | null;
	/** Substring filter, matched case-insensitively. */
	query?: string;
	now?: number;
	limit?: number;
}

const DAY_MS = 86_400_000;

/**
 * Recency weight, halving roughly every week.
 *
 * A gentle curve on purpose: something used daily for a month should not be
 * buried by something used twice yesterday, which is what an aggressive decay
 * does.
 */
function recencyWeight(ageMs: number): number {
	return 2 ** (-Math.max(0, ageMs) / (7 * DAY_MS));
}

function dayKey(ms: number): number {
	return Math.floor(ms / DAY_MS);
}

/**
 * Rank commands by frecency, optionally filtered and biased to a directory.
 *
 * Failures are kept rather than hidden — re-running something that just failed
 * is one of the commonest reasons to reach for history at all — but they rank
 * below equivalent successes.
 */
export function rankCommands(
	rows: readonly CommandHistoryRow[],
	options: RankOptions = {},
): RankedCommand[] {
	const { cwd = null, query = "", now = Date.now(), limit = 50 } = options;
	const needle = query.trim().toLowerCase();

	interface Agg {
		command: string;
		days: Set<number>;
		runs: number;
		lastRunAt: number;
		lastSucceeded: boolean;
		recency: number;
		cwdHits: number;
	}

	const byCommand = new Map<string, Agg>();

	for (const row of rows) {
		if (needle && !row.command.toLowerCase().includes(needle)) continue;

		let agg = byCommand.get(row.command);
		if (!agg) {
			agg = {
				command: row.command,
				days: new Set(),
				runs: 0,
				lastRunAt: 0,
				lastSucceeded: false,
				recency: 0,
				cwdHits: 0,
			};
			byCommand.set(row.command, agg);
		}

		agg.days.add(dayKey(row.startedAt));
		agg.runs++;
		// The MOST RECENT use, not the sum over uses. Summing a per-run weight
		// smuggles raw frequency back into the score through a second door: 40
		// runs in one afternoon would then out-rank ten days of daily use, which
		// is exactly what counting distinct days exists to prevent.
		agg.recency = Math.max(agg.recency, recencyWeight(now - row.startedAt));
		if (cwd && row.cwd === cwd) agg.cwdHits++;
		// Rows arrive in file order, which is chronological — but a resumed
		// session can append out of order, so compare rather than assume.
		if (row.startedAt >= agg.lastRunAt) {
			agg.lastRunAt = row.startedAt;
			agg.lastSucceeded = isSuccessExit(row.exitCode);
		}
	}

	const ranked: RankedCommand[] = [];
	for (const agg of byCommand.values()) {
		// Days carry the weight; raw runs contribute a little so that two
		// commands used on the same number of days aren't arbitrarily tied.
		const habit = agg.days.size + Math.log1p(agg.runs);
		const here = agg.cwdHits > 0 ? 1.5 : 1;
		const worked = agg.lastSucceeded ? 1 : 0.6;
		ranked.push({
			command: agg.command,
			days: agg.days.size,
			runs: agg.runs,
			lastRunAt: agg.lastRunAt,
			lastSucceeded: agg.lastSucceeded,
			score: habit * agg.recency * here * worked,
		});
	}

	ranked.sort((a, b) => b.score - a.score || b.lastRunAt - a.lastRunAt);
	return ranked.slice(0, limit);
}
