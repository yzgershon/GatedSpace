/**
 * The account picker. ONE list, rendered in every place `/swap` can be typed.
 *
 * There used to be three ways to change accounts — a submenu in the profile
 * dropdown, a page on the phone bridge, and the config file — and none of them
 * could tell you whether the thing in front of you had moved, because none of
 * them moved it. They all set a global default that only the NEXT process read.
 *
 * So this list is built around saying what will actually happen:
 *
 *  - In a session pane it swaps THAT conversation, live, and says so.
 *  - Anywhere else it sets what new agents start on, and says *that* instead of
 *    implying a switch it cannot perform. A pty's environment is fixed at
 *    spawn; a running terminal keeps its account and no wording will change it.
 *  - Every row states whether the account is signed in and whether it is out of
 *    quota, because choosing a burnt account used to be a guess you discovered
 *    one prompt later.
 *  - "Auto" resolves to a real account and the row names it. The word "auto" on
 *    its own was the single biggest reason nobody could say which account they
 *    were on.
 */
import { cn } from "@superset/ui/utils";
import { Check, Loader2, Plus, Sparkles, TriangleAlert } from "lucide-react";
import type {
	AccountLimits,
	ClaudeAccount,
	ClaudeAccountsState,
} from "./useClaudeAccounts";

/**
 * Thresholds shared with the sidebar bar and the usage dialog. 70/90 rather
 * than a gradient, for the same reason as there: the number is only ever read
 * as "fine", "getting close" or "about to stop working".
 */
function toneFor(percent: number): string {
	if (percent >= 90) return "bg-destructive";
	if (percent >= 70) return "bg-warning";
	return "bg-success";
}

/**
 * How much of the five-hour window this account has spent.
 *
 * The whole point of the picker is choosing where to go NEXT, and until this
 * existed that choice was made blind — you found out the account you moved to
 * was also nearly spent one prompt later. Deliberately just the five-hour
 * window: it is the one that stops you today, and two bars per row turns a
 * list you scan into a table you read.
 *
 * Renders nothing when the percentage is unknown. A 0% that actually means
 * "never asked" reads as good news, which is the worst way to be wrong here.
 */
function AccountUsage({ limits }: { limits: AccountLimits | undefined }) {
	const percent = limits?.fiveHourPercent ?? null;
	if (percent === null) return null;
	const clamped = Math.max(0, Math.min(100, percent));
	return (
		<span className="mt-1 flex items-center gap-1.5">
			<span className="h-1 w-16 overflow-hidden rounded-full bg-foreground/12">
				<span
					className={cn("block h-full rounded-full", toneFor(clamped))}
					style={{ width: `${clamped}%` }}
				/>
			</span>
			<span className="text-[11px] text-muted-foreground/70 tabular-nums">
				{Math.round(clamped)}% used
			</span>
			{limits?.fiveHourResets ? (
				<span className="truncate text-[11px] text-muted-foreground/50">
					· resets {limits.fiveHourResets.replace(/\s*\([^)]*\)\s*$/, "")}
				</span>
			) : null}
		</span>
	);
}

export interface AccountSwapListProps {
	state: ClaudeAccountsState;
	/**
	 * The account this pane is actually running on.
	 *
	 * The caller resolves it, and must NOT fall back to the globally active
	 * account: that is the drift this whole area was fixed for. A pane's account
	 * is the one its process spawned with, which the global setting stops
	 * describing the moment it changes.
	 */
	pinnedId?: string | null;
	/** Session panes swap live; everything else sets the default. */
	scope: "session" | "default";
	onPick: (account: ClaudeAccount) => void;
	/** Only offered in "default" scope — a pane must name one real account. */
	onPickAuto?: () => void;
	onAddAccount?: () => void;
	/** Rendered under the header, e.g. the pane being swapped. */
	subject?: string;
}

function statusLine(account: ClaudeAccount, isResolvedAuto: boolean): string {
	if (!account.ready) return "Not signed in — start an agent on it to log in";
	if (account.exhausted) return "Out of quota right now";
	if (isResolvedAuto)
		return `${account.email ?? "Signed in"} · auto picks this`;
	return account.email ?? "Signed in";
}

export function AccountSwapList({
	state,
	pinnedId,
	scope,
	onPick,
	onPickAuto,
	onAddAccount,
	subject,
}: AccountSwapListProps) {
	const { accounts, mode, activeId, loading, limits } = state;
	// In a session pane the caller has already resolved which account is
	// running; `activeId` is deliberately NOT a fallback here, because it names
	// the default rather than this pane and ticking the wrong row is exactly how
	// a swap came to look like it had already happened.
	const selectedId = scope === "session" ? (pinnedId ?? null) : null;

	return (
		<div className="flex flex-col py-1">
			<div className="px-2.5 pt-1 pb-1.5">
				<div className="text-[12.5px] text-foreground">
					{scope === "session"
						? "Move this conversation to another account"
						: "Account for new agents"}
				</div>
				<div className="text-[11.5px] text-muted-foreground/80">
					{scope === "session"
						? "Restarts this session on the account you pick and carries the conversation over."
						: "Running agents and terminals keep the account they started on."}
				</div>
				{subject ? (
					<div className="truncate pt-0.5 text-[11.5px] text-muted-foreground/60">
						{subject}
					</div>
				) : null}
			</div>

			{loading && accounts.length === 0 ? (
				<div className="flex items-center gap-2 px-2.5 py-3 text-[12.5px] text-muted-foreground">
					<Loader2 className="size-3.5 animate-spin" />
					Reading your accounts…
				</div>
			) : null}

			{scope === "default" && accounts.length > 1 && onPickAuto ? (
				<button
					type="button"
					onMouseDown={(e) => {
						e.preventDefault();
						onPickAuto();
					}}
					className="flex items-start gap-2.5 px-2.5 py-1.5 text-left transition-colors hover:bg-accent"
				>
					<Sparkles className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
					<span className="min-w-0 flex-1">
						<span className="block text-[13px] text-foreground">Auto</span>
						<span className="block text-[11.5px] text-muted-foreground/80">
							Move to the next signed-in account when one runs out
							{accounts.find((a) => a.id === activeId)
								? ` · on ${accounts.find((a) => a.id === activeId)?.label} now`
								: ""}
						</span>
					</span>
					{mode === "auto" ? (
						<Check className="mt-0.5 size-4 shrink-0 text-primary" />
					) : null}
				</button>
			) : null}

			{accounts.map((account) => {
				const selected =
					scope === "session" ? account.id === selectedId : account.id === mode;
				return (
					<button
						key={account.id}
						type="button"
						// The textarea blurs before a click lands, which would close the
						// palette first — take the action on mousedown, the same as every
						// other row in the slash palette.
						onMouseDown={(e) => {
							e.preventDefault();
							onPick(account);
						}}
						className={cn(
							"flex items-start gap-2.5 px-2.5 py-1.5 text-left transition-colors",
							selected ? "bg-accent/60" : "hover:bg-accent",
						)}
					>
						<span
							className={cn(
								"mt-1.5 size-2 shrink-0 rounded-full",
								!account.ready
									? "bg-muted-foreground/40"
									: account.exhausted
										? "bg-destructive"
										: "bg-success",
							)}
						/>
						<span className="min-w-0 flex-1">
							<span className="block truncate text-[13px] text-foreground">
								{account.label}
							</span>
							<span className="flex items-center gap-1 truncate text-[11.5px] text-muted-foreground/80">
								{account.exhausted ? (
									<TriangleAlert className="size-3 shrink-0 text-destructive" />
								) : null}
								{statusLine(
									account,
									mode === "auto" && account.id === activeId,
								)}
							</span>
							<AccountUsage limits={limits[account.id]} />
						</span>
						{selected ? (
							<Check className="mt-0.5 size-4 shrink-0 text-primary" />
						) : null}
					</button>
				);
			})}

			{onAddAccount ? (
				<button
					type="button"
					onMouseDown={(e) => {
						e.preventDefault();
						onAddAccount();
					}}
					className="mt-1 flex items-center gap-2.5 border-border/60 border-t px-2.5 py-1.5 text-left transition-colors hover:bg-accent"
				>
					<Plus className="size-4 shrink-0 text-muted-foreground" />
					<span className="text-[13px] text-foreground">
						Add a Claude account…
					</span>
				</button>
			) : null}
		</div>
	);
}
