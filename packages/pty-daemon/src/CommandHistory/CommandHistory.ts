/**
 * Turns shell-integration markers into a record of what was actually run.
 *
 * The scanner in @superset/shared reports events; this assembles them into
 * rows. A row needs four things that arrive at different moments — the command
 * text (before execution), the cwd (from the prompt before it), the start time
 * (execution begins) and the exit code (execution ends) — so something has to
 * hold the half-built row in between. That is all this is.
 *
 * It lives in the daemon because `Server.wireSession` is the one place every
 * PTY chunk passes through, whichever client happens to be subscribed. Putting
 * it in either client would mean the other recorded nothing.
 *
 * Written as JSONL next to the scrollback logs rather than into a database:
 * the daemon is a separate process with no DB of its own, and an append-only
 * file needs no migration, no lock, and no schema agreement across a process
 * boundary. A reader can index it however it likes.
 */

import {
	COMMAND_HISTORY_VERSION,
	type CommandHistoryRow,
} from "@superset/shared/command-history";
import {
	createOscScanState,
	type OscScanState,
	scanOscCommandEvents,
} from "@superset/shared/osc-command-scanner";

// The row shape is a contract between the writer here and the reader in the
// desktop, which never call each other — so it is defined in @superset/shared
// and re-exported rather than owned by either side.
export { COMMAND_HISTORY_VERSION, type CommandHistoryRow };

/**
 * Commands never worth keeping.
 *
 * A shell history is one of the classic places secrets leak: they arrive as
 * arguments, get stored in plain text, and are then searched and displayed
 * long after anyone remembers putting them there. The rule here is to drop the
 * whole row rather than store a redacted one — a row that says "you ran
 * something secret at 14:02" has no use that justifies the risk of getting the
 * redaction wrong.
 *
 * Deliberately matched against the command TEXT only. Anything cleverer (entropy
 * scoring, length heuristics) trades a small gain for false negatives that are
 * invisible until they matter.
 */
const DENY_PATTERNS: RegExp[] = [
	// Assignment or export of anything that names itself a credential.
	/\b(?:export\s+|set\s+|\$env:)?[A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|APIKEY|API_KEY|PRIVATE_KEY|CREDENTIAL)[A-Z0-9_]*\s*=/i,
	// Credentials passed as flags.
	/--(?:password|token|api-key|apikey|secret|auth)[= ]/i,
	// Authorization headers.
	/-H\s+['"]?authorization:/i,
	// Anything piping a literal into a login.
	/\b(?:docker|npm|gh|az|aws)\s+login\b.*--password/i,
	// Common one-shot secret shapes.
	/\b(?:gh[pousr]_[A-Za-z0-9]{16,}|sk-[A-Za-z0-9]{16,}|AKIA[0-9A-Z]{12,})\b/,
];

/** Should this command be dropped rather than recorded? */
export function isDeniedCommand(command: string): boolean {
	return DENY_PATTERNS.some((pattern) => pattern.test(command));
}

/** Where a row goes. Injectable so the assembly logic is testable without disk. */
export type CommandHistorySink = (row: CommandHistoryRow) => void;

interface SessionState {
	scan: OscScanState;
	/** Latest cwd the shell reported; carried onto the next command. */
	cwd: string | null;
	/** Command text seen but not yet started. */
	pendingCommand: string | null;
	/** Epoch ms when execution began, or null when nothing is running. */
	startedAt: number | null;
	/** Command text for the run currently in flight. */
	runningCommand: string | null;
}

export class CommandHistory {
	private readonly sessions = new Map<string, SessionState>();

	constructor(
		private readonly sink: CommandHistorySink,
		private readonly now: () => number = Date.now,
	) {}

	/** Feed a chunk of this session's output. */
	observe(sessionId: string, chunk: Uint8Array): void {
		const state = this.stateFor(sessionId);
		for (const event of scanOscCommandEvents(state.scan, chunk)) {
			switch (event.type) {
				case "cwd":
					state.cwd = event.path;
					break;

				case "command-line":
					// Arrives just before execution begins.
					state.pendingCommand = event.text;
					break;

				case "command-start":
					state.startedAt = this.now();
					state.runningCommand = state.pendingCommand;
					state.pendingCommand = null;
					break;

				case "command-end":
					this.finish(sessionId, state, event.exitCode);
					break;

				case "prompt":
					// A prompt with a run still open means the command ended without a
					// D marker — a shell that died mid-command, or integration that
					// stopped emitting. Drop it: a row with no exit code would be a
					// row whose most useful field is a guess.
					state.startedAt = null;
					state.runningCommand = null;
					break;
			}
		}
	}

	/** Forget a session's half-built row. */
	dispose(sessionId: string): void {
		this.sessions.delete(sessionId);
	}

	private stateFor(sessionId: string): SessionState {
		let state = this.sessions.get(sessionId);
		if (!state) {
			state = {
				scan: createOscScanState(),
				cwd: null,
				pendingCommand: null,
				startedAt: null,
				runningCommand: null,
			};
			this.sessions.set(sessionId, state);
		}
		return state;
	}

	private finish(
		sessionId: string,
		state: SessionState,
		exitCode: number,
	): void {
		const command = state.runningCommand;
		const startedAt = state.startedAt;
		state.runningCommand = null;
		state.startedAt = null;

		// No text means the shell reported an exit for something we never saw
		// start — a resumed session, or integration that loaded mid-command.
		// Timing without a command is not a history row.
		if (!command || startedAt === null) return;
		if (isDeniedCommand(command)) return;

		this.sink({
			v: COMMAND_HISTORY_VERSION,
			sessionId,
			command,
			cwd: state.cwd,
			exitCode,
			startedAt,
			durationMs: Math.max(0, this.now() - startedAt),
		});
	}
}
