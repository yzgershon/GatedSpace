/**
 * The three keys worth knowing, under the composer.
 *
 * Only READABLE on the focused pane, but always RENDERED.
 *
 * Repeated under every pane in a four-up it is the same sentence four times
 * over, in the space the transcript wanted — so inactive panes hide it. But
 * hiding it by returning `null` took the row out of the layout, so focusing a
 * pane grew a ~20px strip at the bottom and shoved the whole transcript up a
 * line. Every click into a pane made the text jump.
 *
 * `invisible` keeps the box and drops the ink: the space is reserved
 * identically whether or not the pane has focus, so nothing moves.
 */
import { cn } from "@superset/ui/utils";
import { useSkinTokens } from "renderer/hooks/useSkinTokens";

const HINTS: { key: string; label: string }[] = [
	{ key: "Shift+Tab", label: "mode" },
	{ key: "Esc", label: "cancel" },
	{ key: "Ctrl+X", label: "shortcuts" },
];

export function SessionHintBar({ isActive }: { isActive: boolean }) {
	const { hintBar } = useSkinTokens();
	if (hintBar === "never") return null;

	return (
		<div
			aria-hidden={!isActive}
			className={cn(
				"flex shrink-0 select-none gap-4 px-3 pt-1.5 pb-0.5",
				"font-mono text-[10px] text-muted-foreground/40",
				!isActive && "invisible",
			)}
		>
			{HINTS.map((hint) => (
				<span key={hint.key}>
					<span className="text-muted-foreground/65">{hint.key}</span>:
					{hint.label}
				</span>
			))}
		</div>
	);
}
