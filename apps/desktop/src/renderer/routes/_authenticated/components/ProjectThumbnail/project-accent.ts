/**
 * A stable colour per project, derived from its name.
 *
 * The fallback thumbnail was a grey square with a letter in it, which is the
 * most obviously unfinished thing in the sidebar: five projects, five identical
 * grey squares, and the letter doing all the work of telling them apart.
 *
 * Colour is derived rather than stored so it needs no setup, never has to be
 * migrated, and is identical on every machine that opens the same project.
 * Rename a project and its colour changes — that is the honest trade for
 * zero configuration, and a renamed project is a rare event that already
 * changes how the row looks.
 */

/**
 * FNV-1a. Chosen over summing char codes because that collides badly on short
 * similar names, and this sidebar's whole job is showing several of those at
 * once ("superset" and "SecondBrain" would land close together).
 */
export function hashName(name: string): number {
	let hash = 0x811c9dc5;
	for (let i = 0; i < name.length; i++) {
		hash ^= name.charCodeAt(i);
		// >>> 0 keeps it an unsigned 32-bit value; JS bitwise ops are signed.
		hash =
			(hash +
				((hash << 1) +
					(hash << 4) +
					(hash << 7) +
					(hash << 8) +
					(hash << 24))) >>>
			0;
	}
	return hash;
}

/**
 * Hues are picked from a fixed ring rather than `hash % 360`.
 *
 * Neighbouring hues in the raw space are indistinguishable at 24px, so a fixed
 * set of well-separated stops beats a continuous space here.
 *
 * Two projects CAN land on the same colour, and that is fine: with any fixed
 * palette it becomes likely surprisingly fast (birthday paradox — sixteen stops
 * and a dozen projects is roughly even odds), and the rows are still labelled
 * with different names and different letters. The colour is there to make the
 * list scannable, not to identify a project on its own.
 */
const HUES = [
	12, 30, 48, 68, 92, 120, 145, 168, 190, 212, 235, 258, 282, 305, 325, 345,
];

export interface ProjectAccent {
	/** Background for the thumbnail. */
	background: string;
	/** Text on it. */
	foreground: string;
}

/**
 * Mid-lightness with real chroma, and a near-black foreground.
 *
 * Deliberately the same in light and dark themes: this is an identity mark, and
 * a project changing colour when the theme changes would undo the point of it
 * being stable. Lightness 68% keeps dark text readable on it while staying
 * distinct from both a white and a near-black sidebar.
 */
export function projectAccent(name: string): ProjectAccent {
	const trimmed = name.trim();
	if (!trimmed) {
		return {
			background: "var(--muted)",
			foreground: "var(--muted-foreground)",
		};
	}
	const hue = HUES[hashName(trimmed) % HUES.length] as number;
	return {
		background: `oklch(68% 0.132 ${hue})`,
		foreground: "oklch(21% 0.02 0)",
	};
}

/**
 * The letter shown when a project has no icon of its own.
 *
 * Takes the first LETTER OR DIGIT rather than the first character, so a project
 * called "-internal" or "@scope/app" gets something meaningful instead of
 * punctuation. Falls back to the raw first character when there is none.
 */
export function projectInitial(name: string): string {
	const match = name.match(/[\p{L}\p{N}]/u);
	// `||`, not `??`: charAt on an empty string returns "", which is not nullish
	// and would slip through as a blank badge.
	return (match?.[0] || name.charAt(0) || "?").toUpperCase();
}
