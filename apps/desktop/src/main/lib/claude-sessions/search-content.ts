/**
 * Search inside session transcripts, not just their titles.
 *
 * Titles are generated from the first prompt, so any two sessions started the
 * same way are indistinguishable in the list — a sidebar full of
 * "ok Ive got a ne…" separated only by "2d". Filtering those by title finds
 * nothing you were looking for. What you actually remember is something said
 * in the conversation.
 *
 * Deliberately a plain substring scan and not an index. An index has to be
 * built, invalidated and kept honest against a directory the CLI owns and
 * rewrites underneath us; a scan is always correct and, at these sizes, fast
 * enough. If it ever stops being fast enough the fix is a cache keyed on mtime,
 * the same shape the summary cache already uses.
 */

import { closeSync, openSync, readSync, statSync } from "node:fs";

/**
 * Most bytes read from any single transcript.
 *
 * Transcripts are append-only JSONL and a long session runs to megabytes.
 * Reading every byte of every file on each keystroke is the difference between
 * a search box and a stall, and the tail is where recent conversation lives —
 * which is what you are almost always trying to find again.
 */
const MAX_BYTES_PER_FILE = 2_000_000;

/** Read in pieces rather than whole, so a hit can stop early. */
const CHUNK_BYTES = 256 * 1024;

/**
 * Overlap between chunks, so a match spanning a chunk boundary is not missed.
 * Must exceed the longest query we will honour; the router caps queries well
 * below this.
 */
const CHUNK_OVERLAP = 1024;

/**
 * Whether a file contains `needle`, case-insensitively.
 *
 * Streams from the END of the file backwards in chunks. Recent turns matter
 * more than the opening prompt, and stopping at the first hit means a query
 * that matches something said a minute ago costs one chunk rather than the
 * whole transcript.
 */
export function fileContainsText(filePath: string, needle: string): boolean {
	if (!needle) return false;
	const lower = needle.toLowerCase();

	let fd: number | null = null;
	try {
		const size = statSync(filePath).size;
		if (size === 0) return false;

		fd = openSync(filePath, "r");
		const floor = Math.max(0, size - MAX_BYTES_PER_FILE);
		const buffer = Buffer.allocUnsafe(CHUNK_BYTES);
		let carry = "";
		let position = size;

		while (position > floor) {
			const length = Math.min(CHUNK_BYTES, position - floor);
			position -= length;
			const read = readSync(fd, buffer, 0, length, position);
			if (read <= 0) break;

			// The chunk is prepended: we are walking backwards, so this chunk comes
			// BEFORE the text already carried, and a match straddling the seam has
			// to see them in file order.
			const text = buffer.toString("utf8", 0, read) + carry;
			if (text.toLowerCase().includes(lower)) return true;

			carry = text.slice(0, CHUNK_OVERLAP);
		}
		return false;
	} catch {
		// A transcript deleted or locked mid-scan is not a search failure. Missing
		// one result is survivable; throwing would empty the whole list.
		return false;
	} finally {
		if (fd !== null) {
			try {
				closeSync(fd);
			} catch {}
		}
	}
}

/**
 * Session ids whose transcript contains `query`.
 *
 * Takes the candidates it should scan rather than enumerating its own, so the
 * caller keeps one definition of which sessions exist and in what order — and
 * so this stays usable for Codex, whose files live somewhere else entirely.
 */
export function searchSessionContent(
	candidates: { sessionId: string; filePath: string }[],
	query: string,
	maxFiles: number,
): string[] {
	const needle = query.trim();
	if (!needle) return [];

	const hits: string[] = [];
	for (const candidate of candidates.slice(0, maxFiles)) {
		if (fileContainsText(candidate.filePath, needle)) {
			hits.push(candidate.sessionId);
		}
	}
	return hits;
}
