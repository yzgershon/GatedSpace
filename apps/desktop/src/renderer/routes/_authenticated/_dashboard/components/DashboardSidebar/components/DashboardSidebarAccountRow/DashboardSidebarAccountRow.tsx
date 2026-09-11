/**
 * The pinned account row, and the last thing in the sidebar.
 *
 * Exactly three things, left to right: who you are, what today has cost, and
 * settings. Nothing else earns a permanent seat at the bottom of every window.
 *
 * The theme control used to live here as a moon that cycled light -> dark ->
 * system. It has moved into the account menu as a submenu, because a cycling
 * button is destructive on a set this size — one stray click and the theme you
 * chose is gone — and because a moon promises a binary the app does not have.
 */
import { Tooltip, TooltipContent, TooltipTrigger } from "@superset/ui/tooltip";
import { cn } from "@superset/ui/utils";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { HiOutlineCog6Tooth } from "react-icons/hi2";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { estimateCostUsd, formatUsd } from "renderer/lib/usage-cost";
import { OrganizationDropdown } from "renderer/routes/_authenticated/_dashboard/components/TopBar/components/OrganizationDropdown";
import { getLastSettingsRoute } from "renderer/stores/last-settings-route";

function formatTokens(count: number): string {
	if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
	if (count >= 1_000) return `${Math.round(count / 1_000)}k`;
	return String(count);
}

/**
 * Today's spend, as one value that swaps between tokens and dollars.
 *
 * ONE slot, not two rows. They answer the same question at two resolutions and
 * the bottom of the sidebar has room for one of them; clicking swaps which.
 *
 * The swap is a vertical roll rather than a crossfade: both values are rendered
 * and the pair slides, so the number appears to turn over rather than to be
 * replaced. A crossfade of two different numbers in the same place reads as a
 * glitch. `h-4` with `overflow-hidden` is what makes exactly one of them
 * visible at a time.
 *
 * No label either way. "Tokens today" and "Spent today" spend the width on the
 * word rather than the number, and the unit is already legible from the value —
 * `466k` and `$12.40` cannot be mistaken for each other.
 */
function SpendToday() {
	const [asMoney, setAsMoney] = useState(false);
	const { data: stats } = electronTrpc.usage.getStats.useQuery(undefined, {
		staleTime: 5 * 60_000,
	});

	// Local calendar day, not UTC: "today" means the user's today, and a UTC
	// boundary would roll the number over mid-evening in this timezone.
	const now = new Date();
	const key = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
	const day = stats?.perDay.find((entry) => entry.day === key);
	if (!day) return <span className="min-w-2 flex-1" />;

	const tokens = formatTokens(day.total);
	const money = formatUsd(estimateCostUsd(day.models));

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<button
					type="button"
					onClick={() => setAsMoney((value) => !value)}
					aria-label={
						asMoney ? `${money} spent today` : `${tokens} tokens today`
					}
					className="min-w-0 flex-1 rounded-md px-1 py-1 text-center transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
				>
					<span className="block h-4 overflow-hidden">
						<span
							className={cn(
								"block transition-transform duration-300 ease-out",
								asMoney && "-translate-y-4",
							)}
						>
							<span className="block h-4 text-[12.5px] text-muted-foreground/55 leading-4 tabular-nums">
								{tokens}
							</span>
							<span className="block h-4 text-[12.5px] text-muted-foreground/55 leading-4 tabular-nums">
								{money}
							</span>
						</span>
					</span>
				</button>
			</TooltipTrigger>
			<TooltipContent side="top">
				{asMoney
					? "Estimated at list prices, cache included. Click for tokens."
					: "Tokens today. Click for the estimated cost."}
			</TooltipContent>
		</Tooltip>
	);
}

export function DashboardSidebarAccountRow() {
	const navigate = useNavigate();

	return (
		<div className="flex items-center gap-1">
			<OrganizationDropdown variant="account" />
			<SpendToday />
			<Tooltip>
				<TooltipTrigger asChild>
					<button
						type="button"
						aria-label="Settings"
						onClick={() => navigate({ to: getLastSettingsRoute() })}
						className="flex size-7 shrink-0 items-center justify-center rounded-[7px] text-muted-foreground/60 transition-colors hover:bg-accent/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
					>
						<HiOutlineCog6Tooth className="size-4" />
					</button>
				</TooltipTrigger>
				<TooltipContent side="top">Settings</TooltipContent>
			</Tooltip>
		</div>
	);
}
