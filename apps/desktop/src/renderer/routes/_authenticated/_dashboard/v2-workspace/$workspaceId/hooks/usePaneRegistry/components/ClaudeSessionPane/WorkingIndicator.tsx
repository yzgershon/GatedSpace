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
	CHAR_RISE_PX,
	caretVisible,
	formatElapsed,
	formatTokens,
	phraseAt,
	revealedChars,
	spinnerFrame,
	WORKING_PHRASES,
} from "./working-indicator";

export function WorkingIndicator({
	/** When the current stretch of work began. Defaults to first mount. */
	startedAt,
	/** Show the gerund. Off where the label is already saying what's happening. */
	phrase = true,
	/** Output tokens written so far this turn. Omitted where none are known. */
	tokens,
	className,
}: {
	startedAt?: number;
	phrase?: boolean;
	tokens?: number;
	className?: string;
}) {
	// Derived from the prop, NOT captured in a ref.
	//
	// It used to be `useRef(startedAt ?? Date.now())`, which reads the prop once
	// and ignores it forever after. Whenever this stayed mounted across the start
	// of a new turn, the counter kept running from the previous turn's start —
	// which is why it looked like it had no idea when to reset. The prop is the
	// source of truth when it is given; the ref is only the fallback for callers
	// that don't pass one.
	const fallbackStart = useRef(Date.now());
	const start = startedAt ?? fallbackStart.current;

	// A per-instance offset so two panes working at once don't chant in unison.
	const offsetRef = useRef(Math.floor(Math.random() * WORKING_PHRASES.length));
	const [now, setNow] = useState(() => Date.now());

	// requestAnimationFrame, not setInterval(FRAME_MS).
	//
	// The old 120ms tick was COARSER than the 45ms-per-character type-in, so the
	// phrase appeared in lurches of two or three letters at a time — which is
	// exactly why it didn't read as typing. Sampling every frame lets each
	// character land on its own, and the spinner's 120ms cadence still falls out
	// of the same elapsed-time maths. rAF also stops on its own when the window
	// is hidden, which an interval would not.
	useEffect(() => {
		let frame = 0;
		const tick = () => {
			setNow(Date.now());
			frame = requestAnimationFrame(tick);
		};
		frame = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(frame);
	}, []);

	// Clamped: a startedAt slightly in the future (clock skew between the stamp
	// and this render) would otherwise show a negative counter.
	const elapsed = Math.max(0, now - start);
	const offset = offsetRef.current;
	// Hidden at zero rather than shown as "0 tokens": every turn would open with
	// a number that says nothing, and the line would jump wider the moment the
	// first count arrived.
	const showTokens = typeof tokens === "number" && tokens > 0;
	const full = phraseAt(elapsed, offset);
	const chars = revealedChars(elapsed, offset);

	return (
		// <output> is the semantic element for a live result, and carries
		// role="status" implicitly — which is also what makes the label valid,
		// since a bare span can't take one.
		<output
			className={cn("flex items-baseline gap-2 text-[13.5px]", className)}
			// The full phrase, so a screen reader gets a word rather than a word
			// being typed one letter at a time.
			aria-label={
				showTokens
					? `${full}, ${formatElapsed(elapsed)}, ${formatTokens(tokens)} tokens`
					: `${full}, ${formatElapsed(elapsed)}`
			}
		>
			{/*
			 * The mark takes the theme's primary colour rather than a hardcoded
			 * orange. It used to be literally "#d97757" on the reasoning that
			 * Claude's orange is Claude's orange — which meant it stayed orange in
			 * Dracula and Koi, where nothing else is.
			 */}
			<span
				aria-hidden
				className="inline-block w-3 text-center font-mono text-primary"
			>
				{spinnerFrame(elapsed)}
			</span>
			{phrase ? (
				/*
				 * Every character is rendered from the first frame and only its
				 * opacity changes, so the line's width never moves. Revealing a
				 * growing prefix instead shoves the elapsed counter a few pixels
				 * per character, and that jitter is more noticeable than the typing.
				 */
				<span aria-hidden className="whitespace-pre text-foreground">
					{chars.map((entry, index) => (
						<span
							// Index is a stable key here: the span count is the phrase
							// length, and a phrase change replaces the whole run anyway.
							// biome-ignore lint/suspicious/noArrayIndexKey: positional by nature
							key={index}
							className="inline-block"
							style={{
								opacity: entry.progress,
								transform: `translateY(${(1 - entry.progress) * CHAR_RISE_PX}px)`,
							}}
						>
							{entry.char}
						</span>
					))}
					{/* A caret is what makes this read as typing rather than as text
					    fading up. Solid while characters arrive, blinking after. */}
					<span
						className="ml-px inline-block w-[1px] self-stretch bg-foreground/70 align-middle"
						style={{
							height: "0.9em",
							opacity: caretVisible(elapsed, offset) ? 1 : 0,
						}}
					/>
				</span>
			) : null}
			<span className="text-muted-foreground/70 tabular-nums">
				{formatElapsed(elapsed)}
			</span>
			{showTokens ? (
				/*
				 * Claude Code's own shape: a middot separator and a down-arrow for
				 * "written", so the pair reads as one clause rather than two
				 * competing numbers.
				 *
				 * Tabular figures and a fixed-width arrow keep the line still while
				 * the count climbs — proportional digits shift every neighbouring
				 * pixel on each update, which is far more distracting than the
				 * number is useful.
				 */
				<span
					aria-hidden
					className="flex items-baseline gap-1 text-muted-foreground/70"
				>
					<span className="text-muted-foreground/40">·</span>
					<span className="tabular-nums">
						<span className="mr-0.5 font-mono text-[11px]">↓</span>
						{formatTokens(tokens)}
					</span>
					<span className="text-muted-foreground/50">tokens</span>
				</span>
			) : null}
		</output>
	);
}
