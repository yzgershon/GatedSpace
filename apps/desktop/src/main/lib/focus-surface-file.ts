/**
 * Writes the current focus surface where GatedVoice can read it.
 *
 * See `renderer/lib/focus-surface.ts` for why this exists at all: dictation has
 * to be typed into a terminal and pasted into a controlled React input, and
 * from outside the process both look like the same `<textarea>` in the same
 * Chromium window.
 *
 * A file under the existing `~/.superset` directory, not a port. There is no
 * secret in "a text box has focus", so a socket would only add a handshake, a
 * lifetime and a thing to leak. A reader that finds no file, a stale file or
 * junk simply falls back to typing, which is today's behaviour.
 */
import { writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type FocusSurface = "terminal" | "text" | "other";

export const FOCUS_SURFACES: FocusSurface[] = ["terminal", "text", "other"];

export function isFocusSurface(value: unknown): value is FocusSurface {
	return (
		typeof value === "string" && (FOCUS_SURFACES as string[]).includes(value)
	);
}

export function focusSurfacePath(
	homeDir: string = process.env.SUPERSET_HOME_DIR ||
		join(homedir(), ".superset"),
): string {
	return join(homeDir, "focus-surface.json");
}

export interface FocusSurfaceRecord {
	surface: FocusSurface;
	/** Epoch ms. A reader uses this to ignore a file left by a dead app. */
	at: number;
	/** So a reader can tell which install wrote it when two are installed. */
	pid: number;
}

export function buildFocusSurfaceRecord(
	surface: FocusSurface,
	now: number = Date.now(),
	pid: number = process.pid,
): FocusSurfaceRecord {
	return { surface, at: now, pid };
}

/**
 * Best-effort and synchronous.
 *
 * Synchronous because the payload is ~60 bytes and the ordering matters more
 * than the microseconds: the value must be on disk before the user's next
 * keypress, and that keypress may be the dictation hotkey. Failures are
 * swallowed — a missing hint costs the old behaviour, while an exception here
 * would break focus handling in the app.
 */
export function writeFocusSurface(surface: FocusSurface): void {
	try {
		writeFileSync(
			focusSurfacePath(),
			JSON.stringify(buildFocusSurfaceRecord(surface)),
			"utf8",
		);
	} catch {
		// Nothing to do: the reader treats absent and unreadable the same way.
	}
}
