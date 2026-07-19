/**
 * Reads the most recent USER message from an agent CLI session transcript so
 * the terminal's sticky-prompt bar can show "what you asked" while scrolled
 * up — for both Claude Code and Codex terminals. Local file reads only.
 */
import {
	closeSync,
	existsSync,
	openSync,
	readdirSync,
	readSync,
	statSync,
} from "node:fs";
import { join } from "node:path";
import { getClaudeProjectRoots } from "../claude-profile";
import {
	extractCodexUserText,
	findCodexRolloutPath,
	isCodexPlumbingText,
	readCodexTail,
} from "../codex-sessions";

export type AgentSessionProvider = "claude" | "codex";

export interface AgentLastMessage {
	text: string;
	/** Transcript mtime (ms) when the text was read. */
	at: number;
}

const TAIL_BYTES = 512_000;

function readTail(filePath: string): string[] {
	let size: number;
	try {
		size = statSync(filePath).size;
	} catch {
		return [];
	}
	const length = Math.min(size, TAIL_BYTES);
	if (length <= 0) return [];
	const buffer = Buffer.alloc(length);
	let fd: number;
	try {
		fd = openSync(filePath, "r");
	} catch {
		return [];
	}
	try {
		readSync(fd, buffer, 0, length, size - length);
	} catch {
		return [];
	} finally {
		try {
			closeSync(fd);
		} catch {}
	}
	return buffer.toString("utf8").split("\n").filter(Boolean);
}

const claudePathCache = new Map<string, string>();

function findClaudeTranscriptPath(sessionId: string): string | null {
	const cached = claudePathCache.get(sessionId);
	if (cached && existsSync(cached)) return cached;
	claudePathCache.delete(sessionId);

	const fileName = `${sessionId}.jsonl`;
	for (const root of getClaudeProjectRoots()) {
		let projectDirs: string[];
		try {
			projectDirs = readdirSync(root);
		} catch {
			continue;
		}
		for (const dir of projectDirs) {
			const candidate = join(root, dir, fileName);
			if (existsSync(candidate)) {
				claudePathCache.set(sessionId, candidate);
				return candidate;
			}
		}
	}
	return null;
}

/**
 * Harness-injected user entries that aren't something the user typed: command
 * wrappers, system reminders, tool results, interruption caveats.
 */
function isClaudePlumbingText(text: string): boolean {
	return text.startsWith("<") || text.startsWith("Caveat:");
}

function extractClaudeUserText(obj: Record<string, unknown>): string | null {
	if (obj.type !== "user") return null;
	if (obj.isMeta === true) return null;
	const message = obj.message as { content?: unknown } | undefined;
	const content = message?.content;
	if (typeof content === "string") {
		const text = content.trim();
		return text || null;
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
	return null;
}

interface CacheEntry {
	mtime: number;
	result: AgentLastMessage | null;
}

const resultCache = new Map<string, CacheEntry>();

function lastFromLines(
	lines: string[],
	extract: (obj: Record<string, unknown>) => string | null,
	isPlumbing: (text: string) => boolean,
): string | null {
	for (let i = lines.length - 1; i >= 0; i--) {
		let obj: Record<string, unknown>;
		try {
			obj = JSON.parse(lines[i] as string);
		} catch {
			continue;
		}
		const text = extract(obj);
		if (text && !isPlumbing(text)) return text;
	}
	return null;
}

/**
 * Most recent user message of a session, or null when the transcript can't be
 * found or holds no real user text in its tail window. Cached per transcript
 * mtime so the renderer can poll cheaply.
 */
export function readAgentLastUserMessage(
	provider: AgentSessionProvider,
	sessionId: string,
): AgentLastMessage | null {
	const filePath =
		provider === "codex"
			? findCodexRolloutPath(sessionId)
			: findClaudeTranscriptPath(sessionId);
	if (!filePath) return null;

	let mtime: number;
	try {
		mtime = statSync(filePath).mtimeMs;
	} catch {
		return null;
	}

	const cacheKey = `${provider}:${sessionId}`;
	const cached = resultCache.get(cacheKey);
	if (cached && cached.mtime === mtime) return cached.result;

	const text =
		provider === "codex"
			? lastFromLines(
					readCodexTail(filePath),
					extractCodexUserText,
					isCodexPlumbingText,
				)
			: lastFromLines(
					readTail(filePath),
					extractClaudeUserText,
					isClaudePlumbingText,
				);

	const result = text ? { text, at: mtime } : null;
	resultCache.set(cacheKey, { mtime, result });
	return result;
}
