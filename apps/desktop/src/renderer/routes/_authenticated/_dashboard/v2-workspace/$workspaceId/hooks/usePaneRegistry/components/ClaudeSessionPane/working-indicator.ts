/**
 * The pure parts of the "still working" indicator.
 *
 * Kept out of the component because all four are answerable without rendering —
 * which frame is showing at tick N, how much of the word has typed in, how long
 * it's been, which word we're on — and a spinner that drifts, repeats, or says
 * "1s" for 1.9 seconds is exactly the sort of thing nobody notices in review and
 * everybody notices in use.
 */

/**
 * Claude Code's own spinner frames: a dot that swells into an asterisk. The
 * cycle deliberately isn't a rotation — nothing spins — so it reads as
 * something pulsing rather than something loading.
 */
export const SPINNER_FRAMES = ["·", "✢", "✳", "∗", "✻", "✽"] as const;

/** How long one frame holds. Fast enough to feel alive, slow enough not to buzz. */
export const FRAME_MS = 120;

/**
 * Gerunds, because "Loading…" tells you nothing you didn't know. The list is
 * long so a session doesn't visibly loop, and every entry is unmistakably a
 * machine being whimsical rather than a machine reporting a state — nobody
 * should read "Simmering" and wonder which phase that is.
 */
export const WORKING_PHRASES = [
	"Actioning",
	"Baking",
	"Booping",
	"Brewing",
	"Channelling",
	"Computing",
	"Conjuring",
	"Cooking",
	"Crafting",
	"Deliberating",
	"Determining",
	"Effecting",
	"Finagling",
	"Forging",
	"Generating",
	"Hatching",
	"Herding",
	"Hustling",
	"Ideating",
	"Inferring",
	"Manifesting",
	"Marinating",
	"Moseying",
	"Mulling",
	"Musing",
	"Mustering",
	"Noodling",
	"Percolating",
	"Pondering",
	"Processing",
	"Puttering",
	"Reticulating",
	"Ruminating",
	"Schlepping",
	"Shucking",
	"Simmering",
	"Spinning",
	"Stewing",
	"Synthesizing",
	"Tinkering",
	"Transmuting",
	"Unfurling",
	"Vibing",
	"Whirring",
	"Working",
] as const;

/** How long one phrase stays before the next types in. */
export const PHRASE_MS = 5_000;
/** How fast the phrase types itself in, per character. */
export const TYPE_MS = 45;

/** The spinner glyph for a given elapsed time. */
export function spinnerFrame(elapsedMs: number): string {
	const index = Math.floor(elapsedMs / FRAME_MS) % SPINNER_FRAMES.length;
	return SPINNER_FRAMES[index] ?? SPINNER_FRAMES[0];
}

/**
 * Which phrase is showing, walking the list from a per-session offset so two
 * panes running at once don't chant in unison.
 */
export function phraseAt(elapsedMs: number, offset: number): string {
	const step = Math.floor(elapsedMs / PHRASE_MS);
	const index = (offset + step) % WORKING_PHRASES.length;
	return WORKING_PHRASES[index] ?? WORKING_PHRASES[0];
}

/**
 * The phrase as far as it has typed in. The reveal restarts with each new
 * phrase, so this measures from the start of the CURRENT phrase, not from zero.
 */
export function typedPhrase(elapsedMs: number, offset: number): string {
	const phrase = phraseAt(elapsedMs, offset);
	const intoPhrase = elapsedMs % PHRASE_MS;
	const revealed = Math.floor(intoPhrase / TYPE_MS);
	return phrase.slice(0, Math.min(revealed, phrase.length));
}

/**
 * Elapsed time, in the units someone actually asks in.
 *
 * Rounds DOWN throughout: a counter that says 2s when 1.6 seconds have passed
 * reads as broken the moment it sits next to a stopwatch, and the number is
 * only ever an "at least" claim anyway.
 */
/**
 * How long a finished thought took, in past tense.
 *
 * Under a second it says "a moment" rather than "0s": the number is accurate,
 * but "Thought for 0s" reads as a broken timer rather than a fast answer, and
 * the whole point of the line is to explain a pause that was worth noticing.
 */
export function formatThought(elapsedMs: number): string {
	return elapsedMs < 1000 ? "a moment" : formatElapsed(elapsedMs);
}

export function formatElapsed(elapsedMs: number): string {
	const seconds = Math.floor(elapsedMs / 1000);
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	const rest = seconds % 60;
	if (minutes < 60) return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`;
	const hours = Math.floor(minutes / 60);
	const restMinutes = minutes % 60;
	return restMinutes === 0 ? `${hours}h` : `${hours}h ${restMinutes}m`;
}
