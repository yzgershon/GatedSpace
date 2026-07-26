/**
 * A warning above the composer when a usage window is nearly spent.
 *
 * The header chip has carried this all along, but a chip in the corner is
 * something you notice after it mattered. Running past a limit mid-task is
 * expensive and surprising, and the moment it's worth knowing is the moment
 * you're about to type — which is here.
 *
 * Deliberately silent below the threshold. A banner that's always on stops
 * being read, and then it can't warn about anything.
 */
import { cn } from "@superset/ui/utils";
import { X } from "lucide-react";
import { useState } from "react";

/** Below this, a window isn't worth interrupting anyone about. */
export const WARN_AT_PERCENT = 80;

export interface UsageLimits {
	label?: string;
	fiveHourPercent: number | null;
	fiveHourResets?: string | null;
	weeklyPercent: number | null;
	weeklyResets?: string | null;
}

/**
 * The window worth warning about: whichever is further along, and only once it
 * passes the threshold. Weekly wins ties — it's the one that takes days rather
 * than hours to come back.
 */
export function worstWindow(
	limits: UsageLimits | null | undefined,
): { name: string; percent: number } | null {
	if (!limits) return null;
	const candidates = [
		{ name: "weekly limit", percent: limits.weeklyPercent ?? -1 },
		{ name: "5-hour limit", percent: limits.fiveHourPercent ?? -1 },
	];
	const worst = candidates.reduce((a, b) => (b.percent > a.percent ? b : a));
	return worst.percent >= WARN_AT_PERCENT ? worst : null;
}

export function UsageBanner({
	limits,
	onViewUsage,
}: {
	limits: UsageLimits | null | undefined;
	/** Open the usage panel — wired to typing `/usage` into the composer. */
	onViewUsage?: () => void;
}) {
	const [dismissed, setDismissed] = useState<string | null>(null);
	const worst = worstWindow(limits);
	if (!worst) return null;

	// Dismissal is keyed to the number, so waving it away at 80% doesn't also
	// silence it at 100% — the second warning is the one that matters.
	const key = `${worst.name}:${worst.percent}`;
	if (dismissed === key) return null;

	const spent = worst.percent >= 100;

	return (
		<div
			className={cn(
				"pointer-events-auto mb-1.5 flex w-full max-w-3xl items-center gap-2 rounded-lg px-3 py-1.5 text-[12.5px]",
				spent
					? "bg-destructive/10 text-destructive"
					: "bg-warning/10 text-warning",
			)}
		>
			<span className="min-w-0 flex-1">
				You've used {worst.percent}% of your {worst.name}
				{limits?.label ? ` on ${limits.label}` : ""}
			</span>
			{onViewUsage ? (
				<button
					type="button"
					onClick={onViewUsage}
					className="shrink-0 underline underline-offset-2 transition-opacity hover:opacity-80 focus-visible:outline-none"
				>
					View usage
				</button>
			) : null}
			<button
				type="button"
				aria-label="Dismiss"
				onClick={() => setDismissed(key)}
				className="shrink-0 transition-opacity hover:opacity-80 focus-visible:outline-none"
			>
				<X className="size-3.5" />
			</button>
		</div>
	);
}
