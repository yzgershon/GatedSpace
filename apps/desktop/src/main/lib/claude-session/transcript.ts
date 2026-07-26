/**
 * Reads a stored Claude Code session transcript back into protocol events, so a
 * session pane can show its history after the app restarts.
 *
 * The CLI writes one JSONL transcript per session under
 * `<configDir>/projects/<encoded-cwd>/<sessionId>.jsonl`. Its `assistant` and
 * `user` entries carry the same Anthropic message shape as the live stream, so
 * the shared timeline reducer folds them without a second parser — everything
 * else in the file (titles, mode markers, file-history snapshots, attachments)
 * is a type the reducer already ignores.
 *
 * Two things this does that the live path doesn't need:
 *  - reads a bounded TAIL, because transcripts reach tens of MB;
 *  - drops the CLI's bookkeeping user entries (caveats, command wrappers,
 *    meta), which are real lines in the file but were never something the user
 *    typed into the chat.
 */
import { closeSync, openSync, readdirSync, readSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ClaudeStreamEvent } from "shared/claude-session/events";
import { parseStreamLine } from "shared/claude-session/events";
import { getClaudeProjectRoots } from "../claude-profile";

/** How much of the end of a transcript to read. Older turns are dropped. */
const TAIL_BYTES = 1_500_000;
/** Ceiling on returned events, so a huge session can't stall the renderer. */
const MAX_EVENTS = 4_000;

/** Locate `<sessionId>.jsonl` across every account profile's projects tree. */
function findTranscript(sessionId: string): string | null {
	const file = `${sessionId}.jsonl`;
	for (const root of getClaudeProjectRoots()) {
		let projectDirs: string[];
		try {
			projectDirs = readdirSync(root);
		} catch {
			continue;
		}
		for (const dir of projectDirs) {
			const candidate = join(root, dir, file);
			try {
				if (statSync(candidate).isFile()) return candidate;
			} catch {
				// Not in this project dir; keep looking.
			}
		}
	}
	return null;
}

/** Read the last `TAIL_BYTES`, dropping the partial line at the cut. */
function readTailLines(filePath: string): string[] {
	const { size } = statSync(filePath);
	const length = Math.min(size, TAIL_BYTES);
	const start = size - length;
	const buffer = Buffer.allocUnsafe(length);
	const fd = openSync(filePath, "r");
	try {
		readSync(fd, buffer, 0, length, start);
	} finally {
		closeSync(fd);
	}
	const lines = buffer.toString("utf-8").split("\n");
	// A non-zero start means the first line is almost certainly truncated.
	if (start > 0) lines.shift();
	return lines;
}

/**
 * The CLI logs its own scaffolding as user entries — session-continuation
 * caveats, slash-command wrappers, hook output. They were never typed into the
 * chat, so they don't belong in the rendered history.
 */
function isBookkeeping(raw: Record<string, unknown>): boolean {
	if (raw.isMeta === true) return true;
	if (raw.isVisibleInTranscriptOnly === true) return true;
	if (raw.isCompactSummary === true) return true;
	const content = (raw.message as { content?: unknown } | undefined)?.content;
	if (typeof content !== "string") return false;
	const head = content.trimStart();
	return (
		head.startsWith("<local-command") ||
		head.startsWith("<command-name>") ||
		head.startsWith("<command-message>") ||
		head.startsWith("<system-reminder>")
	);
}

/**
 * Fold-ready events for a stored session, oldest first. Returns an empty array
 * when the transcript can't be found or read — a resumed session still works,
 * it just starts with a blank timeline.
 */
export function loadSessionTranscript(sessionId: string): ClaudeStreamEvent[] {
	const filePath = findTranscript(sessionId);
	if (!filePath) return [];

	let lines: string[];
	try {
		lines = readTailLines(filePath);
	} catch {
		return [];
	}

	const events: ClaudeStreamEvent[] = [];
	for (const line of lines) {
		const event = parseStreamLine(line);
		if (!event) continue;
		if (event.type !== "assistant" && event.type !== "user") continue;
		const raw = event as unknown as Record<string, unknown>;
		if (event.type === "user" && isBookkeeping(raw)) continue;
		// Transcripts leave this undefined where the live stream sends null; the
		// timeline treats it as "belongs to a subagent" if it's truthy either way,
		// but normalising keeps loaded items identical in shape to live ones.
		events.push({
			...event,
			parent_tool_use_id: event.parent_tool_use_id ?? null,
		});
	}

	return events.length > MAX_EVENTS ? events.slice(-MAX_EVENTS) : events;
}
