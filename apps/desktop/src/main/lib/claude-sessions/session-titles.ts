/**
 * User-chosen names for agent sessions.
 *
 * A session's title normally comes out of its transcript — Claude writes
 * periodic `ai-title` entries and the newest one wins. That is a good default
 * and a bad final answer: it is regenerated as the session grows, so a name the
 * user picked would be silently replaced by the model's next summary.
 *
 * Renaming a PANE does not solve this either. That writes `titleOverride` on
 * the pane, which dies with the pane — close it, reopen the same session from
 * the recent list, and the model's title is back. Reported as exactly that:
 * "they always go back to their default session pane titles".
 *
 * So overrides live here instead, keyed by session id, in a file beside the
 * other superset state. Session-scoped, not pane-scoped, so the name survives
 * closing the pane, restarting the app, and resuming the conversation somewhere
 * else entirely.
 *
 * Deliberately NOT written into the transcript. That file is Claude Code's,
 * it is append-only JSONL that the CLI re-reads, and this project has already
 * lost transcripts once to two writers. A sidecar cannot corrupt anything.
 */
import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { SUPERSET_HOME_DIR } from "../app-environment";

const TITLES_FILE = join(SUPERSET_HOME_DIR, "session-titles.json");

/** Long enough to be useful, short enough not to wreck a sidebar row. */
export const MAX_SESSION_TITLE = 120;

type TitleMap = Record<string, string>;

/** Re-read per call rather than cached: another window may have renamed too. */
function read(): TitleMap {
	try {
		if (!existsSync(TITLES_FILE)) return {};
		const parsed: unknown = JSON.parse(readFileSync(TITLES_FILE, "utf8"));
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			return {};
		}
		const out: TitleMap = {};
		for (const [id, title] of Object.entries(
			parsed as Record<string, unknown>,
		)) {
			if (typeof title === "string" && title) out[id] = title;
		}
		return out;
	} catch {
		// A corrupt or unreadable file must not take the sessions list down with
		// it. Falling back to the generated titles is a cosmetic loss.
		return {};
	}
}

/**
 * Write via a temp file and rename.
 *
 * `renameSync` is atomic on both platforms, so a crash mid-write leaves the
 * previous file intact rather than a truncated one that reads as "no names at
 * all" — which would look exactly like every rename being silently discarded.
 */
function write(map: TitleMap): void {
	mkdirSync(dirname(TITLES_FILE), { recursive: true });
	const tmp = `${TITLES_FILE}.${process.pid}.tmp`;
	writeFileSync(tmp, JSON.stringify(map, null, "\t"), "utf8");
	renameSync(tmp, TITLES_FILE);
}

export function readSessionTitleOverrides(): TitleMap {
	return read();
}

export function getSessionTitleOverride(sessionId: string): string | null {
	return read()[sessionId] ?? null;
}

/**
 * Name a session, or pass null/empty to hand it back to the generated title.
 *
 * Clearing rather than storing "" matters: an empty string would render a row
 * with no label at all, and there would be no way to undo it.
 */
export function setSessionTitleOverride(
	sessionId: string,
	title: string | null,
): void {
	const map = read();
	const trimmed = title?.trim().slice(0, MAX_SESSION_TITLE) ?? "";
	if (!trimmed) {
		if (!(sessionId in map)) return;
		delete map[sessionId];
	} else {
		if (map[sessionId] === trimmed) return;
		map[sessionId] = trimmed;
	}
	write(map);
}
