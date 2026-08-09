/**
 * OSC 133 shell readiness scanner (FinalTerm semantic prompt standard).
 *
 * Pure scanning logic, byte-oriented — no per-chunk UTF-8 decoding hop.
 * The marker (`\x1b]133;A...\x07`) is pure ASCII, so byte-level matching
 * is identical to char-level matching while letting callers keep PTY
 * output as opaque bytes from the daemon all the way to xterm.js.
 *
 * Protocol ref: https://gitlab.freedesktop.org/Per_Bothner/specifications/blob/master/proposals/semantic-prompts.md
 * Vendored from WezTerm (MIT, Copyright 2018-Present Wez Furlong).
 */

const OSC_133_A_BYTES = Uint8Array.from(
	[..."\x1b]133;A"].map((c) => c.charCodeAt(0)),
);
const BEL_BYTE = 0x07;
const ESC_BYTE = 0x1b;
const BACKSLASH_BYTE = 0x5c;
/**
 * Once the `\x1b]133;A` prefix matches, every following byte is withheld until
 * a string terminator arrives. An OSC string may end with BEL *or* with ST
 * (`ESC \`) — and ST is what our shell integration actually emits. Verified
 * against live PTY output on 2026-08-09:
 *
 *     \x1b]133;A\x1b\\ \x1b]9;9;C:\Dev\SecondBrain\x1b\\ ... PS C:\Dev>
 *
 * Accepting only BEL meant the scanner latched on the prefix and swallowed the
 * ENTIRE remaining stream — prompt included — until SHELL_READY_TIMEOUT_MS.
 * Windows escaped it because powershell isn't in SHELLS_WITH_READY_MARKER, but
 * every bash/zsh/fish terminal was blank for the first 3 seconds and only
 * recovered on the next repaint.
 *
 * The cap is a second line of defence: a shell that emits the prefix and no
 * terminator at all must not be able to buffer output without bound.
 */
const MAX_HELD_BYTES = 512;

/** Shells whose wrapper files inject OSC 133 markers. */
export const SHELLS_WITH_READY_MARKER = new Set(["zsh", "bash", "fish"]);

/**
 * Mutable state for the byte-by-byte scanner.
 * Callers should create one per terminal session via {@link createScanState}.
 */
export interface ShellReadyScanState {
	matchPos: number;
	/** Bytes withheld from output while a match is in progress. */
	heldBytes: number[];
}

export interface ShellReadyScanResult {
	// Tight ArrayBuffer-backed shape: matches Buffer and what
	// hono/ws WSContext.send accepts, so callers don't need casts.
	output: Uint8Array<ArrayBuffer>;
	matched: boolean;
}

export function createScanState(): ShellReadyScanState {
	return { matchPos: 0, heldBytes: [] };
}

/**
 * Scan a chunk of PTY output for the OSC 133;A (prompt start) marker.
 *
 * Matching bytes are held back from output. On full match (prefix + optional
 * params + string terminator `\a`), they're discarded and `matched` is true.
 * On mismatch, held bytes are flushed as regular terminal output.
 *
 * The scanner handles the marker spanning multiple data chunks.
 */
export function scanForShellReady(
	state: ShellReadyScanState,
	data: Uint8Array,
): ShellReadyScanResult {
	const out: number[] = [];

	for (let i = 0; i < data.length; i++) {
		const b = data[i] as number;
		if (state.matchPos < OSC_133_A_BYTES.length) {
			if (b === OSC_133_A_BYTES[state.matchPos]) {
				state.heldBytes.push(b);
				state.matchPos++;
			} else {
				for (const h of state.heldBytes) out.push(h);
				state.heldBytes.length = 0;
				state.matchPos = 0;
				if (b === OSC_133_A_BYTES[0]) {
					state.heldBytes.push(b);
					state.matchPos = 1;
				} else {
					out.push(b);
				}
			}
		} else {
			// ST is two bytes (`ESC \`). The ESC lands in heldBytes on one
			// iteration and the `\` closes the string on the next.
			const prevHeld = state.heldBytes[state.heldBytes.length - 1];
			const isSt = b === BACKSLASH_BYTE && prevHeld === ESC_BYTE;
			if (b === BEL_BYTE || isSt) {
				state.heldBytes.length = 0;
				state.matchPos = 0;
				const remaining = data.subarray(i + 1);
				const head = Uint8Array.from(out);
				if (remaining.length === 0) {
					return { output: head, matched: true };
				}
				const merged = new Uint8Array(head.length + remaining.length);
				merged.set(head, 0);
				merged.set(remaining, head.length);
				return { output: merged, matched: true };
			}
			state.heldBytes.push(b);
			// No terminator in a plausible marker's worth of bytes — this was
			// not an OSC 133;A after all. Release everything rather than keep
			// swallowing the shell's real output.
			if (state.heldBytes.length > MAX_HELD_BYTES) {
				for (const h of state.heldBytes) out.push(h);
				state.heldBytes.length = 0;
				state.matchPos = 0;
			}
		}
	}

	return { output: Uint8Array.from(out), matched: false };
}
