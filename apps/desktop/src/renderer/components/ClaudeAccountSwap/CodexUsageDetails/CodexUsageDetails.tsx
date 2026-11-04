import type { CodexLimits } from "shared/codex-session/controls";

export function CodexUsageDetails({
	limits,
	compact = false,
}: {
	limits: CodexLimits;
	compact?: boolean;
}) {
	const windows = [
		{
			label: "5-hour",
			percent: limits.fiveHourPercent,
			resets: limits.fiveHourResets,
		},
		{
			label: "Week",
			percent: limits.weeklyPercent,
			resets: limits.weeklyResets,
		},
	];
	if (windows.every((window) => window.percent === null))
		return (
			<span className="text-xs text-muted-foreground">
				Usage not reported by this account
			</span>
		);
	return (
		<span
			className={
				compact
					? "flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground"
					: "flex flex-col gap-3"
			}
		>
			{windows
				.filter((window) => window.percent !== null)
				.map((window) => (
					<span
						key={window.label}
						className={
							compact ? "tabular-nums" : "flex flex-col gap-1.5 text-xs"
						}
					>
						<span className="flex items-center justify-between gap-2">
							<span className="text-muted-foreground">{window.label}</span>
							<span className="font-medium tabular-nums text-foreground">
								{window.percent}% used
							</span>
						</span>
						{!compact && (
							<>
								<meter
									className="sr-only"
									aria-label={`${window.label} usage`}
									min={0}
									max={100}
									value={window.percent ?? 0}
								/>
								<span
									aria-hidden="true"
									className="h-1.5 overflow-hidden rounded-full bg-accent"
								>
									<span
										className={`block h-full rounded-full ${(window.percent ?? 0) >= 90 ? "bg-destructive" : "bg-primary"}`}
										style={{ width: `${window.percent}%` }}
									/>
								</span>
								{window.resets && (
									<span className="text-[11px] text-muted-foreground">
										Resets {window.resets}
									</span>
								)}
							</>
						)}
					</span>
				))}
		</span>
	);
}
