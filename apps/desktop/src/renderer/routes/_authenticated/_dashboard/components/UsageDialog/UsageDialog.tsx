import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@superset/ui/dialog";
import { cn } from "@superset/ui/utils";
import { useMemo } from "react";
import { LuRefreshCw } from "react-icons/lu";
import { electronTrpc } from "renderer/lib/electron-trpc";

interface UsageDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

interface QuotaWindow {
	usedPercent: number;
	windowMinutes: number;
	resetsAt: number;
}
interface ProviderQuota {
	provider: string;
	account: string | null;
	plan: string | null;
	updatedAt: number | null;
	fiveHour: QuotaWindow | null;
	weekly: QuotaWindow | null;
}

const CLAUDE_COLOR = "var(--chart-1)";
const CODEX_COLOR = "var(--chart-2)";

function fmtTokens(n: number): string {
	if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
	if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
	if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
	return `${n}`;
}

interface UsageModelRow {
	name: string;
	in: number;
	out: number;
	total: number;
}

// USD per 1M tokens (input / output), Anthropic API list prices; Codex is
// approximated at GPT-5 rates. Unmatched models fall back to Sonnet-tier.
const PRICE_PER_MTOK: { match: RegExp; in: number; out: number }[] = [
	{ match: /opus/i, in: 15, out: 75 },
	{ match: /sonnet/i, in: 3, out: 15 },
	{ match: /haiku/i, in: 1, out: 5 },
	{ match: /fable/i, in: 3, out: 15 },
	{ match: /codex/i, in: 1.25, out: 10 },
];
const FALLBACK_PRICE = { in: 3, out: 15 };

/**
 * Rough list-price cost of the tokens we count (uncached input + output).
 * This excludes prompt-cache reads/writes — same basis as the token total
 * shown beside it — so it under-counts a real API bill but is consistent
 * with the displayed token figure.
 */
function estimateCostUsd(models: UsageModelRow[]): number {
	let usd = 0;
	for (const m of models) {
		const p =
			PRICE_PER_MTOK.find((r) => r.match.test(m.name)) ?? FALLBACK_PRICE;
		usd += (m.in / 1e6) * p.in + (m.out / 1e6) * p.out;
	}
	return usd;
}

function fmtUsd(n: number): string {
	if (n >= 10_000) return `$${(n / 1000).toFixed(0)}k`;
	if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
	if (n >= 100) return `$${n.toFixed(0)}`;
	return `$${n.toFixed(2)}`;
}

function fmtResetIn(resetsAt: number): string {
	const s = resetsAt - Math.floor(Date.now() / 1000);
	if (s <= 0) return "resets now";
	const d = Math.floor(s / 86400);
	const h = Math.floor((s % 86400) / 3600);
	const m = Math.floor((s % 3600) / 60);
	if (d) return `resets in ${d}d ${h}h`;
	if (h) return `resets in ${h}h ${m}m`;
	return `resets in ${m}m`;
}

function fmtAgo(ms: number): string {
	const s = Math.floor((Date.now() - ms) / 1000);
	if (s < 90) return "just now";
	const m = Math.floor(s / 60);
	if (m < 90) return `${m}m ago`;
	const h = Math.floor(m / 60);
	if (h < 36) return `${h}h ago`;
	return `${Math.floor(h / 24)}d ago`;
}

function meterColor(pct: number): string {
	if (pct >= 80) return "bg-red-500";
	if (pct >= 50) return "bg-yellow-500";
	return "bg-emerald-500";
}

function LimitMeter({
	label,
	window: win,
}: {
	label: string;
	window: QuotaWindow | null;
}) {
	if (!win) {
		return (
			<div className="flex items-center justify-between text-xs">
				<span className="text-muted-foreground">{label}</span>
				<span className="text-muted-foreground/50">no data</span>
			</div>
		);
	}
	const pct = Math.max(0, Math.min(100, win.usedPercent));
	return (
		<div className="flex flex-col gap-1">
			<div className="flex items-baseline justify-between text-xs">
				<span className="text-muted-foreground">{label}</span>
				<span className="font-medium tabular-nums text-foreground">
					{pct}% used
				</span>
			</div>
			<div className="h-1.5 w-full overflow-hidden rounded-full bg-accent">
				<div
					className={cn("h-full rounded-full transition-all", meterColor(pct))}
					style={{ width: `${pct}%` }}
				/>
			</div>
			<div className="text-right text-[10px] text-muted-foreground/70">
				{fmtResetIn(win.resetsAt)}
			</div>
		</div>
	);
}

function ProviderCard({
	name,
	color,
	quota,
	emptyHint,
	isActive,
}: {
	name: string;
	color: string;
	quota: ProviderQuota | undefined;
	emptyHint: string;
	isActive?: boolean;
}) {
	return (
		<div
			className={cn(
				"flex flex-col gap-3 rounded-lg border border-border bg-accent/20 p-4",
				isActive && "border-primary/40",
			)}
		>
			<div className="flex items-center gap-2">
				<span
					className="size-2.5 shrink-0 rounded-full"
					style={{ backgroundColor: color }}
				/>
				<span className="text-sm font-semibold text-foreground">{name}</span>
				{quota?.plan ? (
					<span className="rounded-full border border-border px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
						{quota.plan}
					</span>
				) : null}
				{isActive ? (
					<span className="rounded-full bg-primary/15 px-1.5 py-px text-[10px] font-medium text-primary">
						active
					</span>
				) : null}
				{quota?.updatedAt ? (
					<span className="ml-auto text-[10px] text-muted-foreground/60">
						{fmtAgo(quota.updatedAt)}
					</span>
				) : null}
			</div>
			{quota ? (
				<div className="flex flex-col gap-3">
					<LimitMeter label="5-hour limit" window={quota.fiveHour} />
					<LimitMeter label="Weekly limit" window={quota.weekly} />
				</div>
			) : (
				<div className="flex flex-1 items-center py-2 text-xs leading-relaxed text-muted-foreground/70">
					{emptyHint}
				</div>
			)}
		</div>
	);
}

const GRAPH_WEEKS = 26;
const MONTH_NAMES = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
];

interface GraphCell {
	day: string;
	claude: number;
	codex: number;
	total: number;
	level: 0 | 1 | 2 | 3 | 4;
	future: boolean;
}

const LEVEL_OPACITY = [0, 0.28, 0.5, 0.75, 1] as const;

/**
 * GitHub-style contribution heatmap of daily token usage (Claude + Codex
 * combined; the split shows in each cell's tooltip). Weeks are columns
 * Sunday→Saturday; intensity levels are quartiles of the nonzero days.
 */
function ContributionGraph({
	perDay,
}: {
	perDay: { day: string; total: number; byModel: Record<string, number> }[];
}) {
	const { weeks, monthLabels, activeDays, windowTokens } = useMemo(() => {
		const byDay = new Map(perDay.map((d) => [d.day, d]));

		// Matches perDay's UTC day keys (toISOString) — keep the same calendar.
		const todayKey = new Date().toISOString().slice(0, 10);
		const today = new Date(`${todayKey}T00:00:00Z`);
		// Last day of the current week (Saturday), so today sits mid-column
		// like GitHub renders it.
		const end = new Date(today.getTime() + (6 - today.getUTCDay()) * 86400000);
		const start = new Date(end.getTime() - (GRAPH_WEEKS * 7 - 1) * 86400000);

		const totals: number[] = [];
		const flat: Omit<GraphCell, "level">[] = [];
		for (let i = 0; i < GRAPH_WEEKS * 7; i++) {
			const d = new Date(start.getTime() + i * 86400000);
			const key = d.toISOString().slice(0, 10);
			const row = byDay.get(key);
			const codex = row?.byModel.Codex ?? 0;
			const total = row?.total ?? 0;
			const future = key > todayKey;
			if (!future && total > 0) totals.push(total);
			flat.push({
				day: key,
				claude: Math.max(0, total - codex),
				codex,
				total,
				future,
			});
		}

		const sorted = [...totals].sort((a, b) => a - b);
		const q = (p: number): number =>
			sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ??
			Number.POSITIVE_INFINITY;
		const q1 = q(0.25);
		const q2 = q(0.5);
		const q3 = q(0.75);
		const levelOf = (total: number): GraphCell["level"] => {
			if (total <= 0) return 0;
			if (total <= q1) return 1;
			if (total <= q2) return 2;
			if (total <= q3) return 3;
			return 4;
		};

		const cells: GraphCell[] = flat.map((c) => ({
			...c,
			level: levelOf(c.total),
		}));

		const weeks: GraphCell[][] = [];
		for (let w = 0; w < GRAPH_WEEKS; w++) {
			weeks.push(cells.slice(w * 7, w * 7 + 7));
		}

		// A month label above the first week whose first day enters a new month.
		const monthLabels: (string | null)[] = [];
		let prevMonth = -1;
		for (const week of weeks) {
			const firstDay = week[0]?.day;
			if (!firstDay) {
				monthLabels.push(null);
				continue;
			}
			const month = new Date(`${firstDay}T00:00:00Z`).getUTCMonth();
			monthLabels.push(
				month === prevMonth ? null : (MONTH_NAMES[month] ?? null),
			);
			prevMonth = month;
		}

		return {
			weeks,
			monthLabels,
			activeDays: totals.length,
			windowTokens: totals.reduce((a, b) => a + b, 0),
		};
	}, [perDay]);

	return (
		<div className="flex flex-col gap-2">
			<span className="text-xs font-medium text-muted-foreground">
				<span className="font-semibold text-foreground">
					{fmtTokens(windowTokens)}
				</span>{" "}
				tokens across {activeDays} active days in the last 6 months
			</span>
			<div className="flex flex-col gap-1">
				<div className="flex gap-[3px] pl-7">
					{monthLabels.map((label, i) => (
						<span
							// biome-ignore lint/suspicious/noArrayIndexKey: fixed-width calendar columns
							key={i}
							className="w-[11px] shrink-0 overflow-visible whitespace-nowrap text-[9px] leading-3 text-muted-foreground/70"
						>
							{label ?? ""}
						</span>
					))}
				</div>
				<div className="flex gap-1">
					<div className="flex w-6 shrink-0 flex-col gap-[3px] text-right">
						{["", "Mon", "", "Wed", "", "Fri", ""].map((label, i) => (
							<span
								// biome-ignore lint/suspicious/noArrayIndexKey: fixed weekday rows
								key={i}
								className="h-[11px] text-[9px] leading-[11px] text-muted-foreground/70"
							>
								{label}
							</span>
						))}
					</div>
					<div className="flex gap-[3px]">
						{weeks.map((week) => (
							<div
								key={week[0]?.day ?? "week"}
								className="flex flex-col gap-[3px]"
							>
								{week.map((cell) =>
									cell.future ? (
										<div key={cell.day} className="size-[11px]" />
									) : (
										<div
											key={cell.day}
											className={cn(
												"size-[11px] rounded-[2px]",
												cell.level === 0 && "bg-accent",
											)}
											style={
												cell.level === 0
													? undefined
													: {
															backgroundColor: CLAUDE_COLOR,
															opacity: LEVEL_OPACITY[cell.level],
														}
											}
											title={`${cell.day} · ${fmtTokens(cell.total)} tokens (Claude ${fmtTokens(cell.claude)}, Codex ${fmtTokens(cell.codex)})`}
										/>
									),
								)}
							</div>
						))}
					</div>
				</div>
				<div className="flex items-center justify-end gap-1 pt-1 text-[9px] text-muted-foreground/70">
					<span>Less</span>
					<div className="size-[11px] rounded-[2px] bg-accent" />
					{LEVEL_OPACITY.slice(1).map((opacity) => (
						<div
							key={opacity}
							className="size-[11px] rounded-[2px]"
							style={{ backgroundColor: CLAUDE_COLOR, opacity }}
						/>
					))}
					<span>More</span>
				</div>
			</div>
		</div>
	);
}

export function UsageDialog({ open, onOpenChange }: UsageDialogProps) {
	const utils = electronTrpc.useUtils();
	// Always enabled with a 30-minute auto-refresh: the popup opens with data
	// at most 30 minutes old and keeps itself current while it stays open.
	// Still local-file reads only — quota snapshots update when a Claude
	// statusline renders / a Codex session writes, never by polling any API.
	const { data, isLoading, isFetching } = electronTrpc.usage.getStats.useQuery(
		undefined,
		{
			refetchOnMount: true,
			refetchInterval: 30 * 60 * 1000,
			refetchIntervalInBackground: true,
		},
	);

	const { data: profile } = electronTrpc.usage.getClaudeProfile.useQuery(
		undefined,
		{ enabled: open },
	);

	const estCostUsd = useMemo(
		() => estimateCostUsd((data?.models ?? []) as UsageModelRow[]),
		[data?.models],
	);

	const quotas = (data?.quotas ?? []) as ProviderQuota[];
	const codex = quotas.find((q) => q.provider === "Codex");
	const claudeProfiles = profile?.profiles ?? [];

	return (
		<Dialog open={open} onOpenChange={onOpenChange} modal>
			<DialogContent className="sm:max-w-xl">
				<DialogHeader>
					<div className="flex items-center gap-2">
						<DialogTitle>Usage</DialogTitle>
						<button
							type="button"
							aria-label="Refresh usage"
							onClick={() => utils.usage.getStats.invalidate()}
							className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
						>
							<LuRefreshCw
								className={cn("size-3.5", isFetching && "animate-spin")}
							/>
						</button>
					</div>
					<DialogDescription>
						Read locally from your Claude Code and Codex data. Nothing is sent
						anywhere.
					</DialogDescription>
				</DialogHeader>

				{isLoading ? (
					<div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
						Reading your usage…
					</div>
				) : (
					<div className="flex flex-col gap-4">
						<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
							{(claudeProfiles.length > 0
								? claudeProfiles
								: [{ id: "default", label: "Claude", ready: true }]
							).map((p) => (
								<ProviderCard
									key={p.id}
									name={
										claudeProfiles.length > 1 ? `Claude · ${p.label}` : "Claude"
									}
									color={CLAUDE_COLOR}
									quota={quotas.find(
										(q) => q.provider === "Claude" && q.account === p.label,
									)}
									isActive={
										claudeProfiles.length > 1 &&
										profile?.activeProfileId === p.id
									}
									emptyHint={
										p.ready
											? "Limits appear after your next Claude reply (your status line snapshots them locally)."
											: "Not signed in yet. Launch a Claude agent with this account once to log in."
									}
								/>
							))}
							<ProviderCard
								name="Codex"
								color={CODEX_COLOR}
								quota={codex}
								emptyHint="Limits appear after your next Codex session."
							/>
						</div>

						<ContributionGraph perDay={data?.perDay ?? []} />

						<div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-border pt-3 text-xs text-muted-foreground">
							<span>
								<span className="font-semibold text-foreground">
									{fmtTokens(data?.totalTokens ?? 0)}
								</span>{" "}
								tokens all-time
							</span>
							<span
								title="Estimated at Anthropic API list prices per model (input/output). Excludes prompt-cache reads/writes; Codex is approximated at GPT-5 rates."
								className="cursor-help"
							>
								<span className="font-semibold text-foreground">
									≈ {fmtUsd(estCostUsd)}
								</span>{" "}
								est. API cost
							</span>
							<span>{data?.sessions ?? 0} sessions</span>
							<span>{data?.currentStreak ?? 0}-day streak</span>
						</div>
					</div>
				)}
			</DialogContent>
		</Dialog>
	);
}
