import { describe, expect, it } from "bun:test";
import type { ClaudeStreamEvent } from "shared/claude-session/events";
import { mergeTranscriptWithBuffer } from "./transcript-merge";

function assistant(id: string, text: string): ClaudeStreamEvent {
	return {
		type: "assistant",
		message: { id, content: [{ type: "text", text }] },
	} as unknown as ClaudeStreamEvent;
}

function user(text: string): ClaudeStreamEvent {
	return {
		type: "user",
		message: { content: text },
	} as unknown as ClaudeStreamEvent;
}

function localUser(text: string): ClaudeStreamEvent {
	return {
		type: "local_user_message",
		text,
	} as unknown as ClaudeStreamEvent;
}

function toolResult(toolUseId: string): ClaudeStreamEvent {
	return {
		type: "user",
		message: { content: [{ type: "tool_result", tool_use_id: toolUseId }] },
	} as unknown as ClaudeStreamEvent;
}

function textsOf(events: ClaudeStreamEvent[]): string[] {
	return events.map((event) => {
		if (event.type === "local_user_message") return event.text;
		const content = (event as { message?: { content?: unknown } }).message
			?.content;
		if (typeof content === "string") return content;
		if (Array.isArray(content)) {
			const first = content[0] as { text?: string; tool_use_id?: string };
			return first?.text ?? `tool:${first?.tool_use_id}`;
		}
		return "?";
	});
}

describe("merging the transcript with the live buffer", () => {
	it("falls back to the buffer when nothing is on disk", () => {
		// A brand new session: the CLI has not written anything yet.
		expect(textsOf(mergeTranscriptWithBuffer([], [user("hi")]))).toEqual([
			"hi",
		]);
	});

	it("falls back to the transcript when nothing is in memory", () => {
		// The desktop pane was never opened this run, so there is no buffer —
		// this is the case that used to render a blank conversation.
		expect(textsOf(mergeTranscriptWithBuffer([user("hi")], []))).toEqual([
			"hi",
		]);
	});

	it("shows the history before the point the buffer picks up", () => {
		const transcript = [
			user("first"),
			assistant("m1", "answer one"),
			user("second"),
			assistant("m2", "answer two"),
		];
		// This process attached mid-conversation: its buffer starts at m2.
		const buffer = [assistant("m2", "answer two"), user("third")];

		expect(textsOf(mergeTranscriptWithBuffer(transcript, buffer))).toEqual([
			"first",
			"answer one",
			"second",
			"answer two",
			"third",
		]);
	});

	it("shows the overlapping turn once, not twice", () => {
		const shared = assistant("m1", "answer");
		const merged = mergeTranscriptWithBuffer(
			[user("q"), shared],
			[shared, user("next")],
		);
		expect(textsOf(merged)).toEqual(["q", "answer", "next"]);
	});

	it("joins on an assistant id even when the text is identical", () => {
		// Two turns can read the same and be different turns. The id decides.
		const transcript = [assistant("m1", "ok"), assistant("m2", "ok")];
		const merged = mergeTranscriptWithBuffer(transcript, [
			assistant("m2", "ok"),
		]);
		expect(merged.length).toBe(2);
	});

	it("joins on a tool result, which has no text of its own", () => {
		const transcript = [user("go"), toolResult("tool-1")];
		const merged = mergeTranscriptWithBuffer(transcript, [
			toolResult("tool-1"),
			user("after"),
		]);
		expect(textsOf(merged)).toEqual(["go", "tool:tool-1", "after"]);
	});

	it("treats a locally-sent prompt as the same turn the CLI recorded", () => {
		// The phone's own send shows up as local_user_message in the buffer and
		// as a plain user message in the file. Same turn, two shapes.
		const merged = mergeTranscriptWithBuffer(
			[user("older"), user("from the phone")],
			[localUser("from the phone"), assistant("m9", "on it")],
		);
		expect(textsOf(merged)).toEqual(["older", "from the phone", "on it"]);
	});

	it("appends when the buffer is entirely newer than the file", () => {
		// The CLI flushes on turn completion, so the newest turn can be live in
		// memory and absent from disk. Nothing to join on; nothing to drop.
		const merged = mergeTranscriptWithBuffer(
			[user("old")],
			[assistant("m5", "brand new")],
		);
		expect(textsOf(merged)).toEqual(["old", "brand new"]);
	});

	it("keeps the whole transcript when the buffer holds nothing identifiable", () => {
		// A buffer of only system/init frames must not truncate the history.
		const system = {
			type: "system",
			subtype: "init",
		} as unknown as ClaudeStreamEvent;
		const merged = mergeTranscriptWithBuffer(
			[user("one"), assistant("m1", "two")],
			[system],
		);
		expect(textsOf(merged).slice(0, 2)).toEqual(["one", "two"]);
	});

	it("does not mutate either input", () => {
		const transcript = [user("a")];
		const buffer = [user("b")];
		mergeTranscriptWithBuffer(transcript, buffer);
		expect(transcript.length).toBe(1);
		expect(buffer.length).toBe(1);
	});
});
