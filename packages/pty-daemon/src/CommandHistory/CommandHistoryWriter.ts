/**
 * Appends command-history rows to a JSONL file.
 *
 * One line per command, append-only. A reader can tail it, index it, or
 * rewrite it without coordinating with the daemon, and a partially written
 * final line costs exactly one row rather than the file.
 *
 * Deliberately not a database. The daemon is a separate process with no store
 * of its own; adding one would mean a schema shared across a process boundary,
 * migrations run from two places, and a lock. An append-only file has none of
 * those failure modes, and the volume — a few hundred rows a day — does not
 * come close to needing them.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { ensureSecureDir } from "../secure-fs/index.ts";
import type { CommandHistoryRow } from "./CommandHistory.ts";

/**
 * Rotate past this. A year of heavy use is on the order of a few MB, so this
 * is not about space — it is about a reader never being handed a file so large
 * that indexing it stalls the UI.
 */
export const DEFAULT_MAX_HISTORY_BYTES = 8 * 1024 * 1024;

export class CommandHistoryWriter {
	private readonly filePath: string;
	private readonly maxBytes: number;
	private bytes = 0;
	private failed = false;

	constructor(dir: string, maxBytes = DEFAULT_MAX_HISTORY_BYTES) {
		this.filePath = path.join(dir, "command-history.jsonl");
		this.maxBytes = maxBytes;
		try {
			// Owner-only: a row is a command line, which can carry a secret
			// inline (`export API_KEY=…`, a URL with a password in it).
			ensureSecureDir(dir);
			this.bytes = fs.statSync(this.filePath).size;
		} catch {
			// Missing file is the normal first-run case; a failure to create the
			// directory is handled on first write.
			this.bytes = 0;
		}
	}

	append(row: CommandHistoryRow): void {
		// One failed write disables the writer for the session. Retrying per
		// command on a full or read-only disk would turn a diagnostic into a
		// hot loop in the process that owns every terminal.
		if (this.failed) return;
		try {
			if (this.bytes >= this.maxBytes) this.rotate();
			const line = `${JSON.stringify(row)}\n`;
			fs.appendFileSync(this.filePath, line, { mode: 0o600 });
			this.bytes += Buffer.byteLength(line);
		} catch {
			this.failed = true;
		}
	}

	/**
	 * Keep one previous generation and start fresh.
	 *
	 * Rename rather than truncate: a reader holding the old path keeps reading a
	 * complete file instead of watching it empty underneath them.
	 */
	private rotate(): void {
		try {
			fs.renameSync(this.filePath, `${this.filePath}.1`);
		} catch {
			// If the rename fails the append below will grow the file past the
			// cap, which is better than losing rows.
		}
		this.bytes = 0;
	}
}
