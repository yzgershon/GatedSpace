import { open } from "node:fs/promises";
import type { ClaudeStreamEvent } from "shared/claude-session/events";
import { parseStreamLine } from "shared/claude-session/events";
import { isSyntheticUserTurn } from "shared/claude-session/synthetic-user-turn";

const CHUNK_BYTES = 256 * 1024;
// Allow a full batch of twenty 5 MB image attachments, including base64.
const MAX_LINE_BYTES = 160 * 1024 * 1024;
const MAX_HISTORY_BYTES = 64 * 1024 * 1024;
const MAX_EVENTS = 4_000;

/** Read complete lines newest first, without loading the whole file into memory. */
async function* reverseLines(filePath: string): AsyncGenerator<string | null> {
	const file = await open(filePath, "r");
	let parts: Buffer[] = [];
	let pendingBytes = 0;
	let oversized = false;
	const append = (part: Buffer) => {
		pendingBytes += part.length;
		if (pendingBytes > MAX_LINE_BYTES) {
			parts = [];
			oversized = true;
		} else if (!oversized && part.length) parts.push(part);
	};
	const finish = () => {
		const line = oversized
			? null
			: Buffer.concat(parts.reverse(), pendingBytes).toString("utf8");
		parts = [];
		pendingBytes = 0;
		oversized = false;
		return line;
	};
	try {
		// Snapshot the size: newly appended events arrive through the live buffer.
		let position = (await file.stat()).size;
		while (position > 0) {
			const length = Math.min(CHUNK_BYTES, position);
			position -= length;
			const buffer = Buffer.allocUnsafe(length);
			const { bytesRead } = await file.read(buffer, 0, length, position);
			let end = bytesRead;
			while (end > 0) {
				const newline = buffer.lastIndexOf(10, end - 1);
				if (newline === -1) {
					append(buffer.subarray(0, end));
					break;
				}
				append(buffer.subarray(newline + 1, end));
				yield finish();
				end = newline;
			}
		}
		if (pendingBytes > 0) yield finish();
	} finally {
		await file.close();
	}
}

/**
 * Limit the restored conversation, not the raw log tail. Claude also writes
 * image payloads and duplicated API request records to this log; those must
 * never push every real prompt out of the history window after a restart.
 * Reads are asynchronous so restoring several panes does not block Electron.
 */
export async function readTranscriptFile(
	filePath: string,
): Promise<ClaudeStreamEvent[]> {
	const events: ClaudeStreamEvent[] = [];
	let bytes = 0;
	let limited = false;
	let oversized = false;
	for await (const line of reverseLines(filePath)) {
		if (line === null) {
			oversized = true;
			continue;
		}
		const event = parseStreamLine(line);
		if (!event || (event.type !== "assistant" && event.type !== "user"))
			continue;
		if (!event.message || typeof event.message !== "object") continue;
		if (event.type === "user" && isSyntheticUserTurn(event)) continue;
		events.push({
			...event,
			parent_tool_use_id: event.parent_tool_use_id ?? null,
		});
		bytes += Buffer.byteLength(line);
		if (events.length >= MAX_EVENTS || bytes >= MAX_HISTORY_BYTES) {
			limited = true;
			break;
		}
	}
	const chronological = events.reverse();
	if (limited || oversized) {
		chronological.unshift({
			type: "local_notice",
			id: "transcript-display-limit",
			text: oversized
				? "An unusually large transcript record could not be displayed. The saved conversation is unchanged."
				: "Showing the most recent portion of this long conversation. Earlier messages remain in the saved Claude transcript.",
		});
	}
	return chronological;
}
