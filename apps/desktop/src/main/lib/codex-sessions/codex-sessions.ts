/**
 * Reads Codex CLI session rollouts from disk so the sessions panel can list
 * and resume them, mirroring main/lib/claude-sessions for Claude.
 *
 * Codex stores one JSONL rollout per session under
 * ~/.codex/sessions/<yyyy>/<mm>/<dd>/rollout-<timestamp>-<uuid>.jsonl (plus
 * ~/.codex/archived_sessions). Line 1 is a `session_meta` event carrying the
 * session id and cwd; user prompts appear as `event_msg`/`response_item`
 * entries; periodic `token_count` events carry the latest turn's token usage,
 * which approximates the live context size.
 */
import {
	closeSync,
	existsSync,
	openSync,
	readdirSync,
	readSync,
	statSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, relative, sep } from "node:path";

export interface CodexSessionSummary {
	sessionId: string;
	title: string;
	cwd: string | null;
	projectDirName: string;
	lastModified: number;
	sizeBytes: number;
	contextTokens: number | null;
	filePath: string;
}

const TAIL_BYTES = 1_000_000;
const HEAD_BYTES = 256_000;
const MAX_WALK_DEPTH = 5;

interface RawFile {
	filePath: string;
	projectDirName: string;
	mtime: number;
	size: number;
}

function getSessionRoots(): string[] {
	const home = homedir();
	return [
		join(home, ".codex", "sessions"),
		join(home, ".codex", "archived_sessions"),
	].filter((dir) => existsSync(dir));
}

function walk(root: string, dir: string, depth: number, out: RawFile[]): void {
	if (depth > MAX_WALK_DEPTH) return;
	let entries: string[];
	try {
		entries = readdirSync(dir);
	} catch {
		return;
	}
	for (const entry of entries) {
		const filePath = join(dir, entry);
		let stat: ReturnType<typeof statSync>;
		try {
			stat = statSync(filePath);
		} catch {
			continue;
		}
		if (stat.isDirectory()) {
			walk(root, filePath, depth + 1, out);
			continue;
		}
		if (!entry.startsWith("rollout-") || !entry.endsWith(".jsonl")) continue;
		out.push({
			filePath,
			projectDirName: relative(root, dir).split(sep).join("/"),
			mtime: stat.mtimeMs,
			size: stat.size,
		});
	}
}

function enumerateSessionFiles(): RawFile[] {
	const files: RawFile[] = [];
	for (const root of getSessionRoots()) {
		walk(root, root, 0, files);
	}
	files.sort((a, b) => b.mtime - a.mtime);
	return files;
}

function readSlice(filePath: string, size: number, fromEnd: boolean): string[] {
	const length = Math.min(size, fromEnd ? TAIL_BYTES : HEAD_BYTES);
	if (length <= 0) return [];
	const start = fromEnd ? Math.max(0, size - length) : 0;
	const buffer = Buffer.alloc(length);
	let fd: number;
	try {
		fd = openSync(filePath, "r");
	} catch {
		return [];
	}
	try {
		readSync(fd, buffer, 0, length, start);
	} catch {
		return [];
	} finally {
		try {
			closeSync(fd);
		} catch {}
	}
	return buffer.toString("utf8").split("\n").filter(Boolean);
}

/**
 * Prompt-ish text that is actually harness plumbing, not the user's ask —
 * environment context, AGENTS.md instructions, and similar wrapped blobs.
 */
export function isCodexPlumbingText(text: string): boolean {
	return text.startsWith("<environment_context") ||
		text.startsWith("<user_instructions") ||
		text.startsWith("<turn_context") ||
		text.startsWith("<permissions");
}

export function extractCodexUserText(
	obj: Record<string, unknown>,
): string | null {
	const payload = obj.payload as Record<string, unknown> | undefined;
	if (!payload) return null;

	if (obj.type === "event_msg" && payload.type === "user_message") {
		const message = payload.message;
		if (typeof message === "string" && message.trim()) return message.trim();
	}

	if (
		obj.type === "response_item" &&
		payload.type === "message" &&
		payload.role === "user" &&
		Array.isArray(payload.content)
	) {
		for (const part of payload.content) {
			if (
				part &&
				typeof part === "object" &&
				(part as { type?: string }).type === "input_text" &&
				typeof (part as { text?: string }).text === "string"
			) {
				const text = (part as { text: string }).text.trim();
				if (text) return text;
			}
		}
	}

	return null;
}

interface SessionMeta {
	sessionId: string | null;
	cwd: string | null;
}

function extractSessionMeta(head: string[]): SessionMeta {
	for (const line of head.slice(0, 5)) {
		let obj: Record<string, unknown>;
		try {
			obj = JSON.parse(line);
		} catch {
			continue;
		}
		if (obj.type !== "session_meta") continue;
		const payload = obj.payload as
			| { id?: string; session_id?: string; cwd?: string }
			| undefined;
		return {
			sessionId: payload?.id ?? payload?.session_id ?? null,
			cwd: typeof payload?.cwd === "string" ? payload.cwd : null,
		};
	}
	return { sessionId: null, cwd: null };
}

function extractTitle(head: string[]): string | null {
	for (const line of head) {
		let obj: Record<string, unknown>;
		try {
			obj = JSON.parse(line);
		} catch {
			continue;
		}
		const text = extractCodexUserText(obj);
		if (text && !isCodexPlumbingText(text)) {
			return text.replace(/\s+/g, " ").slice(0, 80);
		}
	}
	return null;
}

/**
 * Locate the rollout file for a Codex session id. Paths are cached per id;
 * a cached path is revalidated with existsSync so archived/deleted files
 * trigger a rescan instead of a stale read.
 */
const rolloutPathCache = new Map<string, string>();

export function findCodexRolloutPath(sessionId: string): string | null {
	const cached = rolloutPathCache.get(sessionId);
	if (cached && existsSync(cached)) return cached;
	rolloutPathCache.delete(sessionId);

	const suffix = `-${sessionId}.jsonl`.toLowerCase();
	for (const file of enumerateSessionFiles()) {
		if (file.filePath.toLowerCase().endsWith(suffix)) {
			rolloutPathCache.set(sessionId, file.filePath);
			return file.filePath;
		}
	}
	return null;
}

/** Tail-read helper shared with the last-message reader. */
export function readCodexTail(filePath: string): string[] {
	let size: number;
	try {
		size = statSync(filePath).size;
	} catch {
		return [];
	}
	return readSlice(filePath, size, true);
}

/**
 * Latest turn's token usage ≈ current context size (`input_tokens` counts the
 * full context sent on the last turn). Display-only approximation.
 */
function extractContextTokens(tail: string[]): number | null {
	for (let i = tail.length - 1; i >= 0; i--) {
		let obj: Record<string, unknown>;
		try {
			obj = JSON.parse(tail[i] as string);
		} catch {
			continue;
		}
		if (obj.type !== "event_msg") continue;
		const payload = obj.payload as
			| {
					type?: string;
					info?: {
						last_token_usage?: Record<string, number>;
						total_token_usage?: Record<string, number>;
					};
			  }
			| undefined;
		if (payload?.type !== "token_count") continue;
		const usage =
			payload.info?.last_token_usage ?? payload.info?.total_token_usage;
		if (!usage) continue;
		return (
			(usage.input_tokens ?? 0) +
			(usage.cached_input_tokens ?? 0) +
			(usage.output_tokens ?? 0)
		);
	}
	return null;
}

/** Filename fallback: rollout-<timestamp>-<uuid>.jsonl → uuid. */
function sessionIdFromFileName(filePath: string): string | null {
	const match = /rollout-.*-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i.exec(
		filePath,
	);
	return match ? (match[1] as string) : null;
}

function summarizeFile(file: RawFile): CodexSessionSummary | null {
	const head = readSlice(file.filePath, file.size, false);
	const meta = extractSessionMeta(head);
	const sessionId = meta.sessionId ?? sessionIdFromFileName(file.filePath);
	if (!sessionId) return null;

	const title = extractTitle(head) ?? "Untitled session";
	const tail = readSlice(file.filePath, file.size, true);

	return {
		sessionId,
		title,
		cwd: meta.cwd,
		projectDirName: file.projectDirName,
		lastModified: file.mtime,
		sizeBytes: file.size,
		contextTokens: extractContextTokens(tail),
		filePath: file.filePath,
	};
}

const summaryCache = new Map<
	string,
	{ mtime: number; summary: CodexSessionSummary | null }
>();

/**
 * List recent Codex CLI sessions, most-recently-modified first. Same contract
 * as listClaudeSessions: never throws, degrades to a partial or empty list.
 */
export function listCodexSessions(limit = 30): CodexSessionSummary[] {
	let files: RawFile[];
	try {
		files = enumerateSessionFiles().slice(0, Math.max(1, limit));
	} catch {
		return [];
	}
	const summaries: CodexSessionSummary[] = [];
	for (const file of files) {
		try {
			const cached = summaryCache.get(file.filePath);
			if (cached && cached.mtime === file.mtime) {
				if (cached.summary) summaries.push(cached.summary);
				continue;
			}
			const summary = summarizeFile(file);
			summaryCache.set(file.filePath, { mtime: file.mtime, summary });
			if (summary) summaries.push(summary);
		} catch {
			// skip unreadable rollouts rather than failing the listing
		}
	}
	return summaries;
}
