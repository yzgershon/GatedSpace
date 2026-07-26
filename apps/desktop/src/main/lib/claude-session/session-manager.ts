/**
 * Main-process registry of live Claude Code sessions, keyed by pane id.
 *
 * Owns the `ClaudeSessionTransport` instances (which spawn the real `claude`
 * binary) and re-emits their events on per-key channels so the trpc
 * `claudeSession.stream` subscription can forward them to the renderer. A
 * module singleton — one per main process.
 *
 * It also keeps a REPLAY BUFFER per session. The renderer's pane unmounts every
 * time you switch tabs, so the timeline can't live only in React state — main
 * is the source of truth. A new subscriber gets the whole conversation replayed
 * before any live event, which is what makes a session survive tab switches and
 * window reloads. Only timeline-bearing events are buffered (the SSE
 * `stream_event` deltas and transient status/hook pings are forwarded live but
 * never stored, or a long session would balloon into tens of thousands of
 * objects).
 */
import { EventEmitter } from "node:events";
import type {
	ClaudeStreamEvent,
	UserImagePayload,
} from "shared/claude-session/events";
import { resolveResumeClaim } from "./resume-claim";
import { type ClaudeSessionOptions, ClaudeSessionTransport } from "./transport";

export interface SessionExitInfo {
	code: number | null;
	signal: NodeJS.Signals | null;
}

/** How many stderr lines to keep as context for a failure notice. */
const STDERR_CONTEXT_LINES = 8;

/** Hard ceiling on buffered events per session (oldest dropped first). */
const MAX_BUFFERED_EVENTS = 10_000;

/**
 * Per-image base64 ceiling. The API rejects images past roughly 5MB, and a
 * rejection surfaces as a failed turn rather than anything that names the
 * image — so the boundary is enforced here, where it can be explained. The
 * composer already downscales, making this the backstop rather than the rule.
 */
const MAX_IMAGE_BASE64 = 5_000_000;

/**
 * Does this event change the timeline? Deltas and lifecycle pings don't — they
 * only matter to a live viewer, so they're forwarded but not stored.
 */
function isReplayable(event: ClaudeStreamEvent): boolean {
	if (event.type === "stream_event") return false;
	if (event.type === "system" && event.subtype !== "init") return false;
	return true;
}

/**
 * A local slash command answers in well under a second — it never reaches the
 * API. If nothing has come back by now, something is wrong and the capture must
 * let go rather than keep swallowing the session's output.
 */
const CAPTURE_TIMEOUT_MS = 8_000;

/**
 * While a capture is open, these events belong to the command being captured and
 * must not reach the timeline. `system` is deliberately absent: init and friends
 * describe the session itself, not the reply, and dropping them would lose state.
 */
function isCapturedEventType(event: ClaudeStreamEvent): boolean {
	return (
		event.type === "assistant" ||
		event.type === "user" ||
		event.type === "stream_event" ||
		event.type === "result"
	);
}

interface PendingCapture {
	settle: (text: string | null) => void;
	timer: ReturnType<typeof setTimeout>;
}

class ClaudeSessionManager extends EventEmitter {
	private readonly sessions = new Map<string, ClaudeSessionTransport>();
	private readonly buffers = new Map<string, ClaudeStreamEvent[]>();
	/** Live claude session id per key, learned from each session's init event. */
	private readonly sessionIds = new Map<string, string>();
	/** Recent stderr per key, kept only to explain a failure. */
	private readonly stderr = new Map<string, string[]>();
	/** Commands whose reply is being diverted away from the timeline. */
	private readonly captures = new Map<string, PendingCapture>();
	/**
	 * Keys with a turn in flight.
	 *
	 * A capture opened mid-turn would swallow THAT turn's reply — the events it
	 * diverts are the same ones a real answer arrives on. The conversation would
	 * silently lose a response and the panel would render the turn's text as if
	 * it were the command's. Both halves wrong, neither loud.
	 */
	private readonly busy = new Set<string>();
	private seq = 0;

	/** Put a line of our own explanation into the session's transcript. */
	private notice(key: string, text: string, fatal = false): void {
		const event: ClaudeStreamEvent = {
			type: "local_notice",
			id: `n-${key}-${this.seq++}`,
			text,
			...(fatal ? { fatal: true } : {}),
		};
		if (!this.buffers.has(key)) this.buffers.set(key, []);
		this.record(key, event);
		this.emit(`event:${key}`, event);
	}

	/** Spawn a session for `key`. No-op if one already exists for that key. */
	start(key: string, opts: ClaudeSessionOptions): void {
		if (this.sessions.has(key)) return;

		// Two writers on one session id silently destroy the newer copy's
		// transcript — it has happened twice. Ownership is claimed HERE, on
		// intent, not when init reports an id: init is a second or two away, and
		// two panes resuming the same id inside that window would both pass.
		const { claim, blockedBy } = resolveResumeClaim(
			key,
			opts.resumeSessionId,
			this.sessionIds,
			(other) => this.sessions.has(other),
		);
		// Blocked means the id is live elsewhere. Fork rather than start fresh:
		// the conversation still carries over, but into a new session id, so the
		// two panes can't overwrite each other's transcript.
		const options = blockedBy ? { ...opts, forkSession: true } : opts;
		// A fork's real id is only known at init, so claim nothing until then.
		if (claim) this.sessionIds.set(key, claim);
		else this.sessionIds.delete(key);
		if (blockedBy) {
			this.notice(
				key,
				"That session is already open in another pane, so this opened a forked copy under a new session id. Both keep their own transcript.",
			);
		}

		const transport = new ClaudeSessionTransport(options);
		// A replaced transport can still flush output on its way out. Every
		// handler checks it's the CURRENT one for this key, so a dying process
		// can't emit into — or worse, deregister — its successor.
		const isCurrent = () => this.sessions.get(key) === transport;
		transport.on("event", (event: ClaudeStreamEvent) => {
			if (!isCurrent()) return;
			if (event.type === "system" && event.subtype === "init") {
				this.sessionIds.set(key, event.session_id);
			}
			// Track turn state BEFORE the capture branch, which returns early: a
			// capture that ate the result must still leave the session idle.
			if (event.type === "assistant" || event.type === "stream_event") {
				this.busy.add(key);
			} else if (event.type === "result") {
				this.busy.delete(key);
			}

			// A captured command's reply is answered into a panel, so it must not
			// reach the timeline OR the replay buffer — otherwise reopening the tab
			// would repaint output the user never saw as chat.
			if (this.captures.has(key) && isCapturedEventType(event)) {
				if (event.type === "result") {
					this.resolveCapture(
						key,
						typeof event.result === "string" ? event.result : null,
					);
				}
				return;
			}
			this.record(key, event);
			this.emit(`event:${key}`, event);
		});
		transport.on("stderr", (line: string) => {
			if (!isCurrent()) return;
			// Kept as context for a failure, not shown line by line — claude writes
			// plenty of stderr in normal operation.
			const recent = this.stderr.get(key) ?? [];
			recent.push(line);
			if (recent.length > STDERR_CONTEXT_LINES) recent.shift();
			this.stderr.set(key, recent);
			this.emit(`stderr:${key}`, line);
		});
		transport.on("exit", (info: SessionExitInfo) => {
			if (!isCurrent()) return;
			this.emit(`exit:${key}`, info);
			this.sessions.delete(key);
			// A clean exit is just the end of a session. Anything else died on us,
			// and saying so beats leaving the pane on a spinner forever.
			if (info.code !== 0 && info.code !== null) {
				this.notice(
					key,
					`Claude exited with code ${info.code}.${this.stderrContext(key)}`,
					true,
				);
			}
			// Keep the buffer: the pane should still show the finished transcript.
		});
		transport.on("error", (err: Error) => {
			if (!isCurrent()) return;
			this.emit(`error:${key}`, err);
			// Spawn failures land here — a preset pointing at a binary that isn't
			// there is the likely cause, and it's invisible without this.
			this.notice(
				key,
				`Couldn't start Claude: ${err.message}${this.stderrContext(key)}`,
				true,
			);
		});
		this.sessions.set(key, transport);
		if (!this.buffers.has(key)) this.buffers.set(key, []);
		transport.start();
	}

	/**
	 * Respawn a session with new options, keeping its transcript.
	 *
	 * This is how a permission-mode change lands: the CLI has no slash command
	 * for it (a real `system/init` lists no `/permissions` or `/mode`), so the
	 * process has to restart. Pass the current session id as `resumeSessionId`
	 * and the conversation carries over — `--resume` loads the history silently
	 * rather than replaying it as events, so nothing duplicates in the timeline.
	 */
	restart(key: string, opts: ClaudeSessionOptions): void {
		const existing = this.sessions.get(key);
		if (existing) {
			this.sessions.delete(key);
			existing.dispose();
		}
		this.start(key, opts);
	}

	/** The tail of stderr, formatted for a failure notice. */
	private stderrContext(key: string): string {
		const lines = (this.stderr.get(key) ?? [])
			.map((line) => line.trim())
			.filter(Boolean);
		if (lines.length === 0) return "";
		return `\n\n${lines.join("\n")}`;
	}

	private record(key: string, event: ClaudeStreamEvent): void {
		if (!isReplayable(event)) return;
		const buffer = this.buffers.get(key);
		if (!buffer) return;
		buffer.push(event);
		if (buffer.length > MAX_BUFFERED_EVENTS) buffer.shift();
	}

	/**
	 * Write the user's prompt to the session and record it as a synthetic event,
	 * so it appears in the transcript on replay (the CLI never echoes it back).
	 * `silent` skips the echo — used for control messages the UI sends on the
	 * user's behalf (e.g. `/effort high`), which shouldn't look like something
	 * they typed.
	 */
	send(
		key: string,
		text: string,
		silent = false,
		images: UserImagePayload[] = [],
	): void {
		const transport = this.sessions.get(key);
		if (!transport) return;

		const oversized = images.filter((i) => i.data.length > MAX_IMAGE_BASE64);
		const usable = images.filter((i) => i.data.length <= MAX_IMAGE_BASE64);
		if (oversized.length > 0) {
			// Say so rather than dropping them quietly: an image that silently
			// vanished looks like the model ignoring what it was shown.
			this.notice(
				key,
				`Skipped ${oversized.length} image${oversized.length === 1 ? "" : "s"} over the size limit: ${oversized
					.map((i) => i.name)
					.join(", ")}`,
			);
		}

		if (!silent) {
			const event: ClaudeStreamEvent = {
				type: "local_user_message",
				id: `u-${key}-${this.seq++}`,
				text,
				// Descriptors only — the base64 never enters the replay buffer, which
				// lives for the whole session.
				...(usable.length
					? {
							attachments: usable.map(({ data: _data, ...rest }) => rest),
						}
					: {}),
			};
			this.record(key, event);
			this.emit(`event:${key}`, event);
		}
		// Busy from the moment we write, not from the first event back: a capture
		// opened in that gap would still land on the turn we just started.
		if (!silent) this.busy.add(key);
		transport.sendUserMessage(text, usable);
	}

	/** Close an open capture, handing the caller whatever came back. */
	private resolveCapture(key: string, text: string | null): void {
		const pending = this.captures.get(key);
		if (!pending) return;
		this.captures.delete(key);
		clearTimeout(pending.timer);
		pending.settle(text);
	}

	/**
	 * Run a LOCAL slash command in the live session and return its reply, without
	 * any of it appearing in the conversation.
	 *
	 * Only for commands the CLI answers itself (`/context`, `/model`, `/usage`) —
	 * they cost no turn, so this spends nothing. It has to run in the live session
	 * rather than a throwaway one because the answers are about THIS session: a
	 * one-shot `/context` reported 23.6k against a conversation actually at 377k.
	 *
	 * Refuses while another capture is open. Two overlapping captures would race
	 * for the same `result` event, and the loser would swallow a real turn's reply
	 * — the conversation silently losing a response is far worse than a panel
	 * failing to open.
	 */
	runCommand(key: string, command: string): Promise<string | null> {
		if (!this.sessions.has(key)) return Promise.resolve(null);
		if (this.captures.has(key)) return Promise.resolve(null);
		// Refuse mid-turn. Capturing here would divert the turn's own reply.
		if (this.busy.has(key)) return Promise.resolve(null);

		return new Promise<string | null>((resolve) => {
			const timer = setTimeout(() => {
				this.resolveCapture(key, null);
			}, CAPTURE_TIMEOUT_MS);
			this.captures.set(key, { settle: resolve, timer });
			// Silent: the user didn't type this into the conversation, and the panel
			// is where the answer is going.
			this.send(key, command, true);
		});
	}

	interrupt(key: string): void {
		this.sessions.get(key)?.interrupt();
	}

	/** Terminate and forget the session for `key`, transcript included. */
	stop(key: string): void {
		// Let go of a capture before the process does: its caller is awaiting a
		// promise that nothing will ever settle once the transport is gone.
		this.resolveCapture(key, null);
		this.busy.delete(key);
		this.buffers.delete(key);
		this.sessionIds.delete(key);
		this.stderr.delete(key);
		const transport = this.sessions.get(key);
		if (!transport) return;
		transport.dispose();
		this.sessions.delete(key);
	}

	isRunning(key: string): boolean {
		return this.sessions.get(key)?.isRunning ?? false;
	}

	/** Everything a fresh subscriber needs to rebuild the timeline. */
	getBufferedEvents(key: string): ClaudeStreamEvent[] {
		return this.buffers.get(key) ?? [];
	}

	/**
	 * Claude session ids currently owned by a live session pane. The recent-
	 * sessions list unions these with the host's terminal bindings so a session
	 * open here is never offered as a plain resume.
	 */
	getLiveSessionIds(): string[] {
		const ids: string[] = [];
		for (const [key, id] of this.sessionIds) {
			if (this.sessions.has(key)) ids.push(id);
		}
		return ids;
	}

	/** True once a session has been started for this key (even if it exited). */
	hasSession(key: string): boolean {
		return this.buffers.has(key);
	}

	/** Tear everything down (app shutdown). */
	disposeAll(): void {
		for (const transport of this.sessions.values()) transport.dispose();
		this.sessions.clear();
		this.buffers.clear();
		this.sessionIds.clear();
		this.stderr.clear();
		this.removeAllListeners();
	}
}

export const claudeSessionManager = new ClaudeSessionManager();
