import { useSyncExternalStore } from "react";
import {
	getCodexSession,
	subscribeCodexSession,
} from "renderer/lib/codex-session/store";
import {
	getSessionSnapshot,
	subscribeSession,
} from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/ClaudeSessionPane/sessionStore";
import { useFocusedSession } from "renderer/stores/focused-session";
/**
 * The five-hour limit, as a bracketed cell readout.
 *
 * Sits directly above the account row, and is deliberately the ONLY bar in the
 * sidebar footer. It answers the question worth asking before starting a long
 * turn — how much of this window is left — which the pane meta strip used to
 * carry over every pane and which was six items too many for a 28px strip.
 *
 * ACCOUNT-AWARE BY CONSTRUCTION. `usage.activeLimits` reads whichever Claude
 * profile is active and returns that profile's label with its windows, so
 * switching accounts switches this readout without anything here knowing that
 * accounts exist. The query refetches on focus rather than sitting on a long
 * stale time, because switching account is exactly the moment the number stops
 * being true.
 *
 * Renders NOTHING when the percentage is unknown. A "0%" that actually means
 * "we have not asked yet" is worse than a gap: it reads as good news.
 */

import { Tooltip, TooltipContent, TooltipTrigger } from "@superset/ui/tooltip";
import { cn } from "@superset/ui/utils";
import { electronTrpc } from "renderer/lib/electron-trpc";

/** How many cells the readout is divided into. */
const CELLS = 16;

/**
 * "Aug 21, 1am (America/New_York)" -> "Aug 21, 1am".
 *
 * The CLI's label carries the timezone so it can stand alone in a report. In a
 * 260px sidebar it wraps onto a second line and doubles the height of the row
 * to restate the machine's own timezone, which is never the question. Stripped
 * HERE rather than at the source: the usage dialog has the width for it and is
 * the place you would actually go looking for which zone a reset is quoted in.
 */
function trimZone(label: string): string {
	return label.replace(/\s*\([^)]*\)\s*$/, "").trim();
}

/**
 * Thresholds, shared with everything else that colours a limit.
 *
 * 70/90 rather than a gradient: the number is only ever read as "fine",
 * "getting close" or "about to stop working", and a continuous ramp makes the
 * middle of that range look like the top of it.
 */
function toneFor(percent: number): "ok" | "warn" | "danger" {
	if (percent >= 90) return "danger";
	if (percent >= 70) return "warn";
	return "ok";
}

export function DashboardSidebarUsageBar() {
	/*
	 * POLLED, and this is the whole reason the number was wrong.
	 *
	 * It read `staleTime: 30_000` with only `refetchOnWindowFocus`, which means
	 * React Query fetches once on mount and then never again while the window
	 * stays focused — so the bar sat at whatever it read when the app started.
	 * Measured: `~/.claude/cache/rate-limits.json` said 95% and was three
	 * minutes old while the sidebar was still showing 46%.
	 *
	 * The CLI rewrites that file as rate-limit headers come back, so it moves
	 * DURING a turn, not only at the end of one. Five seconds tracks that
	 * closely enough to watch it climb while a long turn runs, and the cost is
	 * one small file read per tick.
	 *
	 * `staleTime: 0` because an interval on top of a stale time longer than the
	 * interval refetches on the stale time, not the interval — which is the
	 * same mistake in a new shape. Not polled in the background: a hidden
	 * window has nobody looking at the bar.
	 */
	const focused = useFocusedSession((state) => state.session);
	const provider = focused?.provider ?? "claude";
	const paneId = focused?.paneId ?? "";
	const configDir = useSyncExternalStore(
		(listener) =>
			provider === "claude" && paneId
				? subscribeSession(paneId, listener)
				: () => {},
		() =>
			provider === "claude" && paneId
				? getSessionSnapshot(paneId).accountConfigDir
				: null,
	);
	const model = useSyncExternalStore(
		(listener) =>
			provider === "codex" && paneId
				? subscribeCodexSession(paneId, listener)
				: () => {},
		() => (provider === "codex" ? getCodexSession(paneId)?.model : undefined),
	);
	const queryOptions = {
		staleTime: 0,
		refetchInterval: 5_000,
		refetchIntervalInBackground: false,
		refetchOnWindowFocus: true,
	};
	const active = electronTrpc.usage.activeLimits.useQuery(undefined, {
		...queryOptions,
		enabled: provider === "claude" && !configDir,
	});
	const claude = electronTrpc.usage.limitsFor.useQuery(
		{ configDir: configDir ?? "" },
		{ ...queryOptions, enabled: provider === "claude" && Boolean(configDir) },
	);
	const codex = electronTrpc.codexSession.limits.useQuery(
		{ model },
		{
			...queryOptions,
			refetchInterval: 30_000,
			enabled: provider === "codex",
			retry: false,
		},
	);
	const limits =
		provider === "codex" ? codex.data : configDir ? claude.data : active.data;

	const codexWindow = provider === "codex" ? codex.data?.window : null;
	const percent =
		provider === "codex"
			? (codexWindow?.usedPercent ?? null)
			: (limits?.fiveHourPercent ?? null);
	const windowLabel = codexWindow?.label ?? "5h";
	const windowDescription = codexWindow?.description ?? "5-hour window";
	if (percent === null)
		return (
			<output className="block px-2 py-2 text-xs text-muted-foreground">
				{provider === "codex" ? "Codex" : "Claude"} usage{" "}
				{(
					provider === "codex"
						? codex.isPending
						: configDir
							? claude.isPending
							: active.isPending
				)
					? "loading…"
					: "unavailable"}
			</output>
		);

	const tone = toneFor(percent);
	const lit = Math.round((percent / 100) * CELLS);
	const resetLabel =
		provider === "codex" ? codexWindow?.resets : limits?.fiveHourResets;
	const resets = resetLabel ? trimZone(resetLabel) : null;

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<div
					className={cn(
						"flex flex-col gap-[5px] rounded-[8px] px-2 py-2 transition-colors",
						// Themed through one variable so the shape and the colour stay
						// independent decisions — see the preview.
						tone === "danger"
							? "[--gs-usage:var(--color-destructive)]"
							: tone === "warn"
								? "[--gs-usage:var(--color-warning)]"
								: "[--gs-usage:var(--highlight)]",
					)}
				>
					<div className="flex items-baseline gap-2 font-mono text-[9.5px] uppercase tracking-[0.14em] text-muted-foreground/45">
						<span className="min-w-0 truncate tracking-[0.06em] text-foreground/80">
							{limits?.label ?? "Claude"}
						</span>
						<span>{windowLabel}</span>
						<span
							className="ml-auto text-[11.5px] tabular-nums tracking-normal"
							style={{ color: "var(--gs-usage)" }}
						>
							{percent}%
						</span>
					</div>

					{/*
					 * The brackets are `before`/`after` on the wrapper rather than two
					 * more elements: they are decoration around the cells, and an
					 * element each would put them in the flex flow and make the cells
					 * compute their width against them.
					 */}
					<div className="relative px-[11px] before:absolute before:top-[-3px] before:bottom-[-3px] before:left-0 before:w-[6px] before:border before:border-r-0 before:opacity-60 after:absolute after:top-[-3px] after:right-0 after:bottom-[-3px] after:w-[6px] after:border after:border-l-0 after:opacity-60 before:border-[color:var(--gs-usage)] after:border-[color:var(--gs-usage)]">
						<div className="flex h-3 gap-[2px]">
							{Array.from({ length: CELLS }, (_, index) => (
								<span
									// Positional by nature: the cells are a bar, not a list of
									// things with identities.
									// biome-ignore lint/suspicious/noArrayIndexKey: positional
									key={index}
									className={cn(
										"flex-1 rounded-[1px]",
										index < lit
											? "bg-[var(--gs-usage)]"
											: "bg-foreground/[0.06]",
									)}
									style={
										index < lit
											? {
													boxShadow:
														"0 0 6px color-mix(in oklab, var(--gs-usage) 30%, transparent)",
												}
											: undefined
									}
								/>
							))}
						</div>
					</div>

					{resets ? (
						<span className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-muted-foreground/30">
							resets {resets}
						</span>
					) : null}
				</div>
			</TooltipTrigger>
			<TooltipContent side="top">
				{limits?.label ? `${limits.label} · ` : ""}
				{percent}% of the {windowDescription} used
				{windowLabel === "week" ||
				limits?.weeklyPercent === null ||
				limits?.weeklyPercent === undefined
					? ""
					: ` · ${limits.weeklyPercent}% of the week`}
			</TooltipContent>
		</Tooltip>
	);
}
