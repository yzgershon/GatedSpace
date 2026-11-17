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
 *  - scans complete records asynchronously, bounding returned conversation
 *    events rather than letting internal request blobs crowd out the history;
 *  - drops the CLI's bookkeeping user entries (caveats, command wrappers,
 *    meta), which are real lines in the file but were never something the user
 *    typed into the chat.
 */
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ClaudeStreamEvent } from "shared/claude-session/events";
import { getClaudeProjectRoots } from "../claude-profile";
import { readTranscriptFile } from "./transcript-reader";

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

/**
 * Can the Claude CLI, running under THIS account, find this session?
 *
 * Transcripts live under `<configDir>/projects`, so `--resume <id>` only works
 * for an account whose store holds that file. Multi-account setups usually
 * junction the stores together and every account can see every session; where
 * they are separate, resuming under the wrong one makes the CLI exit rather
 * than continue, and the pane would report a crash for what is really a
 * missing file.
 *
 * Used by `/swap` to decide between carrying the conversation over and starting
 * fresh, so the pane can say which one happened instead of dying.
 */
export function canResumeUnderConfigDir(
	configDir: string,
	sessionId: string,
): boolean {
	const file = `${sessionId}.jsonl`;
	const root = join(configDir, "projects");
	let projectDirs: string[];
	try {
		projectDirs = readdirSync(root);
	} catch {
		return false;
	}
	for (const dir of projectDirs) {
		try {
			if (statSync(join(root, dir, file)).isFile()) return true;
		} catch {
			// Not in this project dir; keep looking.
		}
	}
	return false;
}

/**
 * Fold-ready events for a stored session, oldest first. Returns an empty array
 * when the transcript can't be found or read — a resumed session still works,
 * it just starts with a blank timeline.
 */
export async function loadSessionTranscript(
	sessionId: string,
): Promise<ClaudeStreamEvent[]> {
	const filePath = findTranscript(sessionId);
	if (!filePath) return [];

	try {
		return await readTranscriptFile(filePath);
	} catch {
		return [];
	}
}
