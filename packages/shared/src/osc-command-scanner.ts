/**
 * Watches a PTY stream for OSC 133 command events and OSC 9;9 cwd reports.
 *
 * This is the read side of the shell integration written into the zsh, bash and
 * PowerShell wrappers. Those emit:
 *
 *   133;A          prompt drawn
 *   133;B          command line submitted
 *   133;C          execution begins
 *   133;D;<code>   execution finished, with the exit status
 *   9;9;<path>     working directory
 *
 * From which a caller can reconstruct what ran, where, how long it took and
 * whether it worked — none of which a terminal otherwise knows.
 *
 * OBSERVE ONLY. Unlike `shell-ready-scanner`, this never withholds or rewrites
 * a byte: it is handed the same chunk the terminal gets and reports what it
 * saw. Two consumers mutating one stream is how a TUI ends up corrupted, and
 * the sequences are invisible to the renderer anyway.
 *
 * Byte-oriented for the same reason as the ready scanner: the markers are pure
 * ASCII, so matching on bytes avoids a UTF-8 decode hop and cannot split a
 * multi-byte character.
 *
 * Protocol ref: https://gitlab.freedesktop.org/Per_Bothner/specifications/blob/master/proposals/semantic-prompts.md
 */

const ESC = 0x1b;
const BEL = 0x07;
const OSC_INTRODUCER = 0x5d; // ']'
const BACKSLASH = 0x5c; // the '\' of a String Terminator (ESC \)

/**
 * Longest OSC payload worth buffering.
 *
 * A sequence that never terminates would otherwise grow without bound on a
 * stream that is mostly not for us — a binary file catted to the terminal will
 * contain a stray ESC ] sooner or later. Past this the scanner gives up on that
 * sequence and resynchronises rather than holding memory for a marker that is
 * never coming. Paths can be long; 4 KB is far past any real cwd.
 */
const MAX_PAYLOAD_BYTES = 4096;

/** Our command-line marker; see parseOscPayload for why it is not 633;E. */
const COMMAND_LINE_PREFIX = "777;superset-cmd;";

export type OscCommandEvent =
	| { type: "prompt" }
	| { type: "command-line"; text: string }
	| { type: "command-start" }
	| { type: "command-end"; exitCode: number }
	| { type: "cwd"; path: string };

type ScanPhase = "idle" | "escaped" | "in-osc" | "in-osc-escaped";

export interface OscScanState {
	phase: ScanPhase;
	payload: number[];
	/** Payload overflowed; skip to the terminator without collecting. */
	overflowed: boolean;
}

export function createOscScanState(): OscScanState {
	return { phase: "idle", payload: [], overflowed: false };
}

function decodePayload(bytes: number[]): string {
	// Latin-1 rather than UTF-8: a path with non-ASCII bytes must round-trip
	// through this unchanged, and the parts we match on are ASCII regardless.
	let out = "";
	for (const b of bytes) out += String.fromCharCode(b);
	return out;
}

/**
 * Turn one completed OSC payload into an event, or null when it isn't ours.
 *
 * Exported for tests: the parsing rules are where the protocol details live,
 * and they are easier to pin here than through a byte stream.
 */
export function parseOscPayload(payload: string): OscCommandEvent | null {
	if (payload === "133;A") return { type: "prompt" };
	// 'B' is "command line ends", 'C' is "execution begins". Both arrive
	// together from our wrappers; 'C' is the one that means work started, so
	// 'B' is deliberately ignored rather than double-counting a command.
	if (payload === "133;C") return { type: "command-start" };

	if (payload.startsWith("133;D")) {
		// `133;D` with no code is legal and means "finished, status unknown".
		// Treating that as success would silently mark failures green.
		const rest = payload.slice("133;D".length);
		if (rest === "") return null;
		if (!rest.startsWith(";")) return null;
		const code = Number.parseInt(rest.slice(1), 10);
		if (!Number.isFinite(code)) return null;
		return { type: "command-end", exitCode: code };
	}

	// Our own namespace, matching the existing 777;superset-shell-ready marker.
	// Deliberately NOT VS Code's 633;E: that code implies percent-encoding, and
	// claiming a compatibility we don't implement is worse than being private.
	//
	// No decoding. The wrappers strip ESC and BEL (either would terminate the
	// sequence early) and fold newlines to spaces, so the payload is already
	// the text. An escaping scheme here would only add a way to be wrong.
	if (payload.startsWith(COMMAND_LINE_PREFIX)) {
		const text = payload.slice(COMMAND_LINE_PREFIX.length);
		if (!text) return null;
		return { type: "command-line", text };
	}

	if (payload.startsWith("9;9;")) {
		const path = payload.slice("9;9;".length);
		if (!path) return null;
		return { type: "cwd", path };
	}

	return null;
}

/**
 * Feed a chunk of PTY output. Returns the events it contained, in order.
 *
 * The scanner is resumable: a sequence split across chunk boundaries — which
 * happens constantly, since chunk edges have nothing to do with escape
 * sequences — is carried in `state` and completed on a later call.
 */
export function scanOscCommandEvents(
	state: OscScanState,
	data: Uint8Array,
): OscCommandEvent[] {
	const events: OscCommandEvent[] = [];

	const finish = (): void => {
		if (!state.overflowed) {
			const event = parseOscPayload(decodePayload(state.payload));
			if (event) events.push(event);
		}
		state.phase = "idle";
		state.payload.length = 0;
		state.overflowed = false;
	};

	for (let i = 0; i < data.length; i++) {
		const b = data[i] as number;

		switch (state.phase) {
			case "idle":
				if (b === ESC) state.phase = "escaped";
				break;

			case "escaped":
				// Only ']' opens an OSC. Anything else is some other escape
				// sequence we have no interest in; a second ESC restarts.
				if (b === OSC_INTRODUCER) {
					state.phase = "in-osc";
					state.payload.length = 0;
					state.overflowed = false;
				} else if (b === ESC) {
					state.phase = "escaped";
				} else {
					state.phase = "idle";
				}
				break;

			case "in-osc":
				if (b === BEL) {
					finish();
				} else if (b === ESC) {
					// Possible String Terminator; decided on the next byte.
					state.phase = "in-osc-escaped";
				} else if (state.payload.length >= MAX_PAYLOAD_BYTES) {
					state.overflowed = true;
				} else if (!state.overflowed) {
					state.payload.push(b);
				}
				break;

			case "in-osc-escaped":
				if (b === BACKSLASH) {
					finish();
				} else if (b === ESC) {
					// ESC ESC inside an OSC: stay pending on the next byte.
					state.phase = "in-osc-escaped";
				} else {
					// Not a terminator after all — the ESC was payload.
					if (!state.overflowed && state.payload.length < MAX_PAYLOAD_BYTES) {
						state.payload.push(ESC, b);
					}
					state.phase = "in-osc";
				}
				break;
		}
	}

	return events;
}
