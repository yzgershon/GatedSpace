/**
 * Reads Claude Code CLI session transcripts from disk so the UI can present a
 * recent-sessions history (title, last-modified, context size) and resume them.
 *
 * Claude Code stores one JSONL transcript per session under
 * <configDir>/projects/<encoded-cwd>/<sessionId>.jsonl per account profile
 * (profile stores may be junctioned together — we de-dupe by realpath). Each
 * transcript carries periodic `ai-title` entries (Claude's generated summary)
 * and `assistant` entries whose usage gives the current context size. Titles
 * update as the session grows, so the newest one lives near the end — we read a
 * bounded tail rather than the whole file (transcripts reach tens of MB).
 */
import {
	closeSync,
	openSync,
	readdirSync,
	readSync,
	realpathSync,
	statSync,
} from "node:fs";
import { join } from "node:path";
import { getClaudeProjectRoots } from "../claude-profile";

export interface ClaudeSessionSummary {
	sessionId: string;
	title: string;
	cwd: string | null;
	projectDirName: string;
	lastModified: number;
	sizeBytes: number;
	contextTokens: number | null;
	filePath: string;
}

const TAIL_BYTES = 1_500_000;
const HEAD_BYTES = 64_000;

interface RawFile {
	filePath: string;
	projectDirName: string;
	sessionId: string;
	mtime: number;
	size: number;
}

function getProjectsDirs(): string[] {
	return getClaudeProjectRoots();
}

function enumerateSessionFiles(): RawFile[] {
	const seen = new Set<string>();
	const files: RawFile[] = [];
	for (const base of getProjectsDirs()) {
		let projectDirs: string[];
		try {
			projectDirs = readdirSync(base);
		} catch {
			continue;
		}
		for (const projectDirName of projectDirs) {
			const projectDir = join(base, projectDirName);
			try {
				if (!statSync(projectDir).isDirectory()) continue;
			} catch {
				continue;
			}
			let entries: string[];
			try {
				entries = readdirSync(projectDir);
			} catch {
				continue;
			}
			for (const entry of entries) {
				if (!entry.endsWith(".jsonl")) continue;
				const filePath = join(projectDir, entry);
				// De-dupe across the junctioned account dirs.
				let real: string;
				try {
					real = realpathSync(filePath);
				} catch {
					real = filePath;
				}
				if (seen.has(real)) continue;
				seen.add(real);
				let stat: ReturnType<typeof statSync>;
				try {
					stat = statSync(filePath);
				} catch {
					continue;
				}
				files.push({
					filePath,
					projectDirName,
					sessionId: entry.replace(/\.jsonl$/, ""),
					mtime: stat.mtimeMs,
					size: stat.size,
				});
			}
		}
	}
	files.sort((a, b) => b.mtime - a.mtime);
	return files;
}

function readSlice(filePath: string, size: number, fromEnd: boolean): string[] {
	const length = Math.min(size, fromEnd ? TAIL_BYTES : HEAD_BYTES);
	if (length <= 0) return [];
	const start = fromEnd ? Math.max(0, size - length) : 0;
	const buffer = Buffer.alloc(length);
	// A transcript can be deleted, locked by an active session, or race with a
	// rotating file between enumerate and read. Never let a single unreadable
	// file take down the whole listing — treat it as empty and move on.
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

function firstUserText(head: string[]): string | null {
	for (const line of head) {
		let obj: Record<string, unknown>;
		try {
			obj = JSON.parse(line);
		} catch {
			continue;
		}
		if (obj.type !== "user") continue;
		const message = obj.message as { content?: unknown } | undefined;
		const content = message?.content;
		if (typeof content === "string" && content.trim()) {
			return content.trim();
		}
		if (Array.isArray(content)) {
			for (const part of content) {
				if (
					part &&
					typeof part === "object" &&
					(part as { type?: string }).type === "text" &&
					typeof (part as { text?: string }).text === "string"
				) {
					const text = (part as { text: string }).text.trim();
					if (text) return text;
				}
			}
		}
	}
	return null;
}

function summarizeFile(file: RawFile): ClaudeSessionSummary {
	let title: string | null = null;
	let contextTokens: number | null = null;
	let cwd: string | null = null;

	const tail = readSlice(file.filePath, file.size, true);
	// Walk the tail newest-first: the last ai-title is the freshest summary and
	// the last assistant usage is the current context size.
	for (let i = tail.length - 1; i >= 0; i--) {
		let obj: Record<string, unknown>;
		try {
			obj = JSON.parse(tail[i] as string);
		} catch {
			continue;
		}
		if (!cwd && typeof obj.cwd === "string") cwd = obj.cwd;
		if (!title && obj.type === "ai-title" && typeof obj.aiTitle === "string") {
			title = obj.aiTitle;
		}
		if (contextTokens == null && obj.type === "assistant") {
			const usage = (obj.message as { usage?: Record<string, number> })?.usage;
			if (usage) {
				contextTokens =
					(usage.input_tokens ?? 0) +
					(usage.cache_read_input_tokens ?? 0) +
					(usage.cache_creation_input_tokens ?? 0);
			}
		}
		if (title && contextTokens != null && cwd) break;
	}

	// No generated title yet (short session, or title predates the tail window):
	// fall back to the opening user prompt.
	if (!title) {
		const head = readSlice(file.filePath, file.size, false);
		const prompt = firstUserText(head);
		title = prompt
			? prompt.replace(/\s+/g, " ").slice(0, 80)
			: "Untitled session";
		if (!cwd) {
			for (const line of head) {
				try {
					const obj = JSON.parse(line) as { cwd?: string };
					if (typeof obj.cwd === "string") {
						cwd = obj.cwd;
						break;
					}
				} catch {}
			}
		}
	}

	return {
		sessionId: file.sessionId,
		title,
		cwd,
		projectDirName: file.projectDirName,
		lastModified: file.mtime,
		sizeBytes: file.size,
		contextTokens,
		filePath: file.filePath,
	};
}

const summaryCache = new Map<
	string,
	{ mtime: number; summary: ClaudeSessionSummary }
>();

/** Minimal summary for a transcript we couldn't parse, so it still shows up. */
function fallbackSummary(file: RawFile): ClaudeSessionSummary {
	return {
		sessionId: file.sessionId,
		title: "Untitled session",
		cwd: null,
		projectDirName: file.projectDirName,
		lastModified: file.mtime,
		sizeBytes: file.size,
		contextTokens: null,
		filePath: file.filePath,
	};
}

/**
 * List recent Claude CLI sessions, most-recently-modified first. Only the top
 * `limit` transcripts are parsed; results are cached per file+mtime so repeat
 * calls are cheap.
 *
 * This is called over IPC to populate the recent-sessions panel, so it must
 * never throw: a rejected query renders as a bare error with no history at all.
 * Any per-file or top-level failure degrades to a partial (or empty) list.
 */
export function listClaudeSessions(limit = 30): ClaudeSessionSummary[] {
	let files: RawFile[];
	try {
		files = enumerateSessionFiles().slice(0, Math.max(1, limit));
	} catch {
		return [];
	}
	return files.map((file) => {
		try {
			const cached = summaryCache.get(file.filePath);
			if (cached && cached.mtime === file.mtime) return cached.summary;
			const summary = summarizeFile(file);
			summaryCache.set(file.filePath, { mtime: file.mtime, summary });
			return summary;
		} catch {
			return fallbackSummary(file);
		}
	});
}
