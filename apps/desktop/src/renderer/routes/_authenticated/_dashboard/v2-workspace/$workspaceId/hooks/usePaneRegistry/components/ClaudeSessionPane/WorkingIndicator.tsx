/**
 * "Still working" — an animated mark, a gerund that types itself in, and how
 * long it's been.
 *
 * A static dim label can't distinguish "thinking hard" from "hung", which is the
 * only question anyone has while waiting. Motion answers it continuously, and
 * the elapsed counter answers it precisely.
 *
 * One timer drives everything. Frames, the phrase, the typing and the counter
 * are all pure functions of elapsed time (see working-indicator.ts), so there's
 * no animation state to drift out of sync, and remounting mid-turn resumes at
 * the right frame instead of restarting the word.
 */
import { cn } from "@superset/ui/utils";
import { useEffect, useRef, useState } from "react";
import {
	FRAME_MS,
	formatElapsed,
	phraseAt,
	spinnerFrame,
	typedPhrase,
	WORKING_PHRASES,
} from "./working-indicator";

/** The mark is Claude's orange in every theme, like the send button. */
const MARK_COLOR = "#d97757";

export function WorkingIndicator({
	/** When the current stretch of work began. Defaults to first mount. */
	startedAt,
	/** Show the gerund. Off where the label is already saying what's happening. */
	phrase = true,
	className,
}: {
	startedAt?: number;
	phrase?: boolean;
	className?: string;
}) {
	const startRef = useRef(startedAt ?? Date.now());
	// A per-instance offset so two panes working at once don't chant in unison.
	const offsetRef = useRef(Math.floor(Math.random() * WORKING_PHRASES.length));
	const [elapsed, setElapsed] = useState(() => Date.now() - startRef.current);

	useEffect(() => {
		const id = setInterval(() => {
			setElapsed(Date.now() - startRef.current);
		}, FRAME_MS);
		return () => clearInterval(id);
	}, []);

	const offset = offsetRef.current;
	const full = phraseAt(elapsed, offset);
	const typed = typedPhrase(elapsed, offset);

	return (
		// <output> is the semantic element for a live result, and carries
		// role="status" implicitly — which is also what makes the label valid,
		// since a bare span can't take one.
		<output
			className={cn("flex items-baseline gap-2 text-[13.5px]", className)}
			// The full phrase, so a screen reader gets a word rather than a word
			// being typed one letter at a time.
			aria-label={`${full}, ${formatElapsed(elapsed)}`}
		>
			<span
				aria-hidden
				className="inline-block w-3 text-center font-mono"
				style={{ color: MARK_COLOR }}
			>
				{spinnerFrame(elapsed)}
			</span>
			{phrase ? (
				<span aria-hidden className="text-foreground">
					{typed}
					{/* The ellipsis waits for the word to finish typing, otherwise it
					    reads as a word that trailed off rather than one arriving. */}
					{typed.length === full.length ? "…" : ""}
				</span>
			) : null}
			<span className="text-muted-foreground/70 tabular-nums">
				{formatElapsed(elapsed)}
			</span>
		</output>
	);
}
