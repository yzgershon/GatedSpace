/**
 * Reads the command-history JSONL the pty-daemon writes, and ranks it.
 *
 * The daemon appends; this only ever reads. They share nothing but the file
 * format in `@superset/shared/command-history`, which is deliberate — the
 * daemon is a separate process, and a reader that had to coordinate with it
 * would need a lock the append-only design exists to avoid.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	type CommandHistoryRow,
	parseCommandHistory,
	type RankedCommand,
	rankCommands,
} from "@superset/shared/command-history";

/**
 * Only the tail is read. Frecency decays by half a week, so the far end of an
 * 8MB file cannot influence the ranking — and reading all of it on every
 * palette open would stall the UI for the one thing that must feel instant.
 */
const MAX_READ_BYTES = 2 * 1024 * 1024;

/** Mirrors the daemon's own default; see `pty-daemon/src/main.ts`. */
function historyFilePath(): string {
	return path.join(
		os.homedir(),
		".superset",
		"terminal-scrollback",
		"command-history.jsonl",
	);
}

interface Cache {
	path: string;
	key: string;
	rows: CommandHistoryRow[];
}

let cache: Cache | null = null;

/**
 * Rows from disk, re-read only when the file has actually changed.
 *
 * Keyed on size AND mtime: size alone misses an in-place rewrite, and mtime
 * alone has a resolution coarser than the gap between two quick commands.
 */
function loadRows(filePath: string): CommandHistoryRow[] {
	let stat: fs.Stats;
	try {
		stat = fs.statSync(filePath);
	} catch {
		// No file yet is the normal state until the first command completes.
		cache = null;
		return [];
	}

	const key = `${stat.size}:${stat.mtimeMs}`;
	if (cache?.path === filePath && cache.key === key) return cache.rows;

	let contents: string;
	try {
		if (stat.size <= MAX_READ_BYTES) {
			contents = fs.readFileSync(filePath, "utf-8");
		} else {
			const fd = fs.openSync(filePath, "r");
			try {
				const buffer = Buffer.allocUnsafe(MAX_READ_BYTES);
				fs.readSync(fd, buffer, 0, MAX_READ_BYTES, stat.size - MAX_READ_BYTES);
				// The window almost certainly opens mid-row. Drop to the first line
				// break so the parser is never handed a fragment it would count as a
				// corrupt row rather than a partial one.
				const text = buffer.toString("utf-8");
				const firstBreak = text.indexOf("\n");
				contents = firstBreak === -1 ? "" : text.slice(firstBreak + 1);
			} finally {
				fs.closeSync(fd);
			}
		}
	} catch {
		return cache?.rows ?? [];
	}

	const rows = parseCommandHistory(contents);
	cache = { path: filePath, key, rows };
	return rows;
}

export interface CommandHistoryQuery {
	/** Bias toward commands previously run here. */
	cwd?: string | null;
	query?: string;
	limit?: number;
	/**
	 * Test seam. Production always reads the daemon's own path — a caller that
	 * could point this somewhere else would be a caller that could read an
	 * arbitrary file through a tRPC procedure.
	 */
	filePath?: string;
}

export function getRankedCommandHistory(
	options: CommandHistoryQuery = {},
): RankedCommand[] {
	return rankCommands(loadRows(options.filePath ?? historyFilePath()), {
		cwd: options.cwd ?? null,
		query: options.query ?? "",
		limit: options.limit ?? 50,
	});
}

/** Test seam — the cache would otherwise outlive a fixture. */
export function resetCommandHistoryCache(): void {
	cache = null;
}
