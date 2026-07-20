import { cn } from "@superset/ui/utils";
import { useEffect, useRef } from "react";
import "./BootScreen.css";

/**
 * Minimum time the boot splash stays on screen so the logo draw + wordmark
 * decode play in full. Hydration (cloud) or the static local session usually
 * resolves in a few hundred ms, so without this floor the animation would be
 * cut off almost immediately. Consumers gate on this alongside their own
 * readiness. Tune here to make the splash shorter or longer.
 */
export const MIN_SPLASH_MS = 2150;

const WORDMARK = "GATED SPACE";
const GLYPHS = "ABCDEF0123456789<>[]{}/\\=+*#$%&_?";
/** ms after mount before the wordmark starts decoding (lets the mark draw first). */
const DECODE_START_MS = 1150;
/** ms the scramble-to-resolve takes. */
const DECODE_DURATION_MS = 900;

/**
 * App-launch splash: the "Watchman" mark strokes itself in and its eye-slits
 * ignite, then GATED SPACE decodes in — characters scramble through random
 * glyphs and resolve left-to-right, terminal style, with a blinking cursor.
 * The logo/eyes run on CSS; the decode is driven here so it can scramble.
 */
export function BootScreen({ className }: { className?: string }) {
	const codeRef = useRef<HTMLSpanElement>(null);

	useEffect(() => {
		const el = codeRef.current;
		if (!el) return;
		if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
			el.textContent = WORDMARK;
			return;
		}
		let raf = 0;
		const start = performance.now();
		const rnd = () => GLYPHS[(Math.random() * GLYPHS.length) | 0];
		const tick = (now: number) => {
			const elapsed = now - start;
			if (elapsed < DECODE_START_MS) {
				el.textContent = "";
				raf = requestAnimationFrame(tick);
				return;
			}
			const progress = Math.min(
				1,
				(elapsed - DECODE_START_MS) / DECODE_DURATION_MS,
			);
			const revealed = Math.round(progress * WORDMARK.length);
			let out = "";
			for (let i = 0; i < WORDMARK.length; i++) {
				const char = WORDMARK[i];
				out += char === " " ? " " : i < revealed || progress >= 1 ? char : rnd();
			}
			el.textContent = out;
			if (progress < 1) raf = requestAnimationFrame(tick);
		};
		raf = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(raf);
	}, []);

	return (
		<div
			className={cn("boot-screen bg-background text-foreground", className)}
			role="img"
			aria-label="Starting GatedSpace"
		>
			<svg
				className="boot-mark"
				viewBox="22 18 56 68"
				fill="none"
				xmlns="http://www.w3.org/2000/svg"
				aria-hidden="true"
			>
				<path
					className="boot-dome"
					pathLength={1}
					d="M28 82 V46 A22 22 0 0 1 72 46 V82 Z"
				/>
				<rect className="boot-eye" x="34" y="53" width="13" height="9" />
				<rect className="boot-eye" x="53" y="53" width="13" height="9" />
			</svg>
			<div className="boot-wordmark" aria-hidden="true">
				<span className="boot-code" ref={codeRef} />
				<span className="boot-cursor" />
			</div>
		</div>
	);
}
