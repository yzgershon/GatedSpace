import type { ClaudeStreamEvent } from "shared/claude-session/events";

/**
 * Joining a conversation already in progress.
 *
 * Two sources hold different parts of the same conversation and neither holds
 * all of it:
 *
 *  - the **transcript on disk**, which the CLI appends to as turns complete. It
 *    goes back to the beginning of the conversation, and lags the newest turn
 *    until that turn finishes.
 *  - the **replay buffer in memory**, which starts the moment this process
 *    attached to the session and is live to the token. Everything before that —
 *    including the whole conversation, if the session was resumed — is missing.
 *
 * The phone was served the buffer alone, which is why opening a session showed
 * an empty screen: from the phone's point of view the conversation began when
 * it happened to look.
 *
 * They OVERLAP rather than abut, so concatenating them repeats whatever the
 * buffer and the file both contain. The join is found by identity: the first
 * transcript entry that also appears in the buffer is where the buffer's
 * account takes over, so the transcript is cut there.
 */

/**
 * A value that is the same for the same turn in both sources.
 *
 * Assistant messages carry an id from the API, which is exact. User turns have
 * no id anywhere, so their text stands in — two identical prompts in a row
 * would be indistinguishable, and joining one turn early is a far better
 * failure than showing the turn twice.
 */
function identityOf(event: ClaudeStreamEvent): string | null {
	if (event.type === "local_user_message") {
		const text = event.text.trim();
		return text ? `u:${text}` : null;
	}

	const message = (event as { message?: { id?: unknown; content?: unknown } })
		.message;
	if (!message) return null;

	if (event.type === "assistant" && typeof message.id === "string") {
		return `a:${message.id}`;
	}

	if (event.type === "user") {
		if (typeof message.content === "string" && message.content.trim()) {
			return `u:${message.content.trim()}`;
		}
		// Tool results arrive as a content array. They are keyed off the id of the
		// tool_use they answer, which is stable across both sources.
		if (Array.isArray(message.content)) {
			for (const block of message.content) {
				const id = (block as { tool_use_id?: unknown }).tool_use_id;
				if (typeof id === "string") return `t:${id}`;
			}
		}
	}

	return null;
}

export function mergeTranscriptWithBuffer(
	transcript: readonly ClaudeStreamEvent[],
	buffer: readonly ClaudeStreamEvent[],
): ClaudeStreamEvent[] {
	if (!transcript.length) return [...buffer];
	if (!buffer.length) return [...transcript];

	const inBuffer = new Set<string>();
	for (const event of buffer) {
		const identity = identityOf(event);
		if (identity) inBuffer.add(identity);
	}

	const joinAt = transcript.findIndex((event) => {
		const identity = identityOf(event);
		return identity !== null && inBuffer.has(identity);
	});

	// No overlap found — either the buffer is entirely newer than the file (the
	// CLI has not flushed it yet) or nothing in either source is identifiable.
	// Appending is right in the first case and harmless in the second.
	if (joinAt === -1) return [...transcript, ...buffer];

	return [...transcript.slice(0, joinAt), ...buffer];
}
