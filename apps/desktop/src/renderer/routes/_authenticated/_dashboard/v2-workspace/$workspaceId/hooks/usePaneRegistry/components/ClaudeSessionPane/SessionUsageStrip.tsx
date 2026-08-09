/**
 * Account and limits, centred in the session header.
 *
 * This is the part of the terminal statusline worth keeping: which account is
 * spending, how much of each window is gone, when they come back, and what it
 * has cost. Everything else that line carried — model, session name, agent
 * count — is either shown elsewhere or noise.
 *
 * Anything unknown is simply absent rather than rendered as a zero or a dash.
 * A "0%" that actually means "we haven't asked yet" is worse than a gap,
 * because it reads as good news.
 */
import { cn } from "@superset/ui/utils";
import type { UsageLimits } from "./usage-limits";

/**
 * The statusline's block meter: ▕████░░░░▏
 *
 * Blocks rather than a bar because it reads as a discrete quantity at this size
 * — a 2px-tall bar in a header is a smudge, and rounding it to eighths makes
 * "nearly full" visibly different from "full".
 */
function Meter({ percent }: { percent: number }) {
	// Drawn as a real bar rather than block glyphs. Blocks inherited the theme's
	// MUTED colour and rendered as a grey-blue smudge at 11px — unreadable at a
	// glance, which is the only way this is ever read.
	//
	// The fix for that was three literal hex values, which then stayed put in
	// every theme. These are the semantic tokens instead: still deliberately
	// loud, but a loud that belongs to the theme in use.
	const color =
		percent >= 90
			? "var(--color-destructive)"
			: percent >= 70
				? "var(--color-warning)"
				: "var(--color-success)";
	return (
		<span
			aria-hidden
			className="inline-flex h-2 w-14 overflow-hidden rounded-[2px] bg-foreground/10 align-middle"
		>
			<span
				className="h-full rounded-[2px]"
				style={{
					width: `${Math.min(Math.max(percent, 0), 100)}%`,
					backgroundColor: color,
				}}
			/>
		</span>
	);
}

function Window({
	label,
	percent,
	resets,
	compact,
}: {
	label: string;
	percent: number | null;
	resets: string | null;
	/** Side-by-side panes: meter and number only, no reset time. */
	compact?: boolean;
}) {
	if (percent === null) return null;
	return (
		<span
			className="flex items-center gap-1"
			title={resets ? `${label} · resets ${resets}` : label}
		>
			<span className="font-medium text-foreground/70">{label}</span>
			<Meter percent={percent} />
			<span
				className={cn(
					"font-medium tabular-nums",
					percent >= 90
						? "text-destructive"
						: percent >= 70
							? "text-warning"
							: "text-foreground",
				)}
			>
				{percent}%
			</span>
			{resets && !compact ? (
				<span className="text-foreground/55">↻ {resets}</span>
			) : null}
		</span>
	);
}

/** Costs are small enough that two decimals would read as zero all day. */
function formatCost(costUsd: number): string {
	if (costUsd > 0 && costUsd < 0.01) return "<$0.01";
	return `$${costUsd.toFixed(costUsd < 10 ? 2 : 0)}`;
}

export function SessionUsageStrip({
	limits,
	costUsd,
	compact,
}: {
	limits?: UsageLimits | null;
	costUsd?: number;
	/**
	 * Panes are side by side, so spend the width on what changes minute to
	 * minute. Reset times and session cost drop out; the account and both
	 * meters stay — which account is spending and how much is left are the two
	 * things worth a glance while four agents run at once.
	 */
	compact?: boolean;
}) {
	const hasWindows =
		limits &&
		(limits.fiveHourPercent !== null || limits.weeklyPercent !== null);
	if (!limits?.label && !hasWindows && costUsd === undefined) return null;

	return (
		<span
			className={cn(
				"flex min-w-0 items-center text-[11px]",
				compact ? "gap-2" : "gap-3",
			)}
		>
			{limits?.label ? (
				// The account is first because it qualifies everything after it: the
				// percentages mean nothing until you know whose they are. Kept even
				// when compact — with three accounts in rotation, "whose limit is
				// this" is the question the strip exists to answer.
				<span className="truncate font-medium text-foreground">
					{limits.label}
				</span>
			) : null}
			<Window
				label="5h"
				percent={limits?.fiveHourPercent ?? null}
				resets={limits?.fiveHourResets ?? null}
				compact={compact}
			/>
			<Window
				label="wk"
				percent={limits?.weeklyPercent ?? null}
				resets={limits?.weeklyResets ?? null}
				compact={compact}
			/>
			{costUsd === undefined || compact ? null : (
				<span
					className="font-medium tabular-nums text-foreground/70"
					title="API cost for this session"
				>
					{formatCost(costUsd)}
				</span>
			)}
		</span>
	);
}
