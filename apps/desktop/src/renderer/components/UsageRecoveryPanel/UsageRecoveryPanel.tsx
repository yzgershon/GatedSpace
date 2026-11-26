import { Popover, PopoverContent, PopoverTrigger } from "@superset/ui/popover";
import { useState } from "react";
import { LuArrowRight, LuCircleAlert, LuClock3, LuX } from "react-icons/lu";
import type { UsageRecoveryState } from "shared/usage-recovery";

const actionClass =
	"inline-flex min-h-8 items-center justify-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";

/** Non-modal popovers keep other panes and their composers usable. */
export function UsageRecoveryPanel({
	recovery,
	onContinue,
	onAutoContinue,
}: {
	recovery: UsageRecoveryState;
	onContinue: () => Promise<unknown>;
	onAutoContinue: (enabled: boolean) => Promise<unknown>;
}) {
	const [open, setOpen] = useState<"continue" | "auto" | null>(null);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string>();
	const reset = recovery.resetAt
		? new Intl.DateTimeFormat(undefined, {
				weekday: "short",
				hour: "numeric",
				minute: "2-digit",
			}).format(recovery.resetAt)
		: null;
	const busy = pending || recovery.continuing;
	const run = async (action: () => Promise<unknown>) => {
		if (busy) return;
		setPending(true);
		setError(undefined);
		try {
			await action();
			setOpen(null);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
			setOpen(null);
		} finally {
			setPending(false);
		}
	};
	return (
		<section
			aria-label="Usage limit recovery"
			className="mx-3 my-2 shrink-0 rounded-xl border border-destructive/25 bg-destructive/5 p-3 text-xs"
		>
			<div className="flex min-w-0 items-start gap-2">
				<LuCircleAlert
					className="mt-0.5 size-3.5 shrink-0 text-destructive"
					aria-hidden
				/>
				<div className="min-w-0 flex-1">
					<p className="font-medium text-foreground">Usage limit reached</p>
					<p className="mt-0.5 text-muted-foreground">
						{recovery.autoContinue
							? `Will continue ${reset ? `after ${reset}` : "when the limit resets"}.`
							: reset
								? `Resets ${reset}. Your conversation is saved.`
								: "Your conversation is saved. The reset time isn't available yet."}
					</p>
				</div>
			</div>
			<div className="mt-2.5 flex flex-wrap items-center gap-2">
				<Popover
					modal={false}
					open={open === "continue"}
					onOpenChange={(value) => setOpen(value ? "continue" : null)}
				>
					<PopoverTrigger asChild>
						<button type="button" className={actionClass} disabled={busy}>
							<LuArrowRight className="size-3.5" aria-hidden />
							{recovery.continuing ? "Continuing…" : "Continue session"}
						</button>
					</PopoverTrigger>
					<PopoverContent
						side="top"
						align="start"
						className="w-72 max-w-[calc(100vw-2rem)] space-y-3 rounded-xl p-4 text-xs"
					>
						<p className="text-sm font-semibold">Continue this conversation</p>
						<p className="leading-relaxed text-muted-foreground">
							Sends a request to pick up where the agent stopped, with the same
							conversation, account, and settings. Completed work stays in
							place.
						</p>
						<p className="leading-relaxed text-muted-foreground">
							This uses your account's usage. If the limit hasn't reset, the
							session may stop again.
						</p>
						<div className="flex justify-end gap-2">
							<button
								type="button"
								className={actionClass}
								onClick={() => setOpen(null)}
							>
								Cancel
							</button>
							<button
								type="button"
								className={
									actionClass +
									" bg-primary text-primary-foreground hover:bg-primary/90"
								}
								disabled={busy}
								onClick={() => void run(onContinue)}
							>
								Continue now
							</button>
						</div>
					</PopoverContent>
				</Popover>
				{recovery.autoContinue ? (
					<button
						type="button"
						className={actionClass}
						disabled={busy}
						onClick={() => void run(() => onAutoContinue(false))}
					>
						<LuX className="size-3.5" aria-hidden />
						Cancel auto-continue
					</button>
				) : (
					<Popover
						modal={false}
						open={open === "auto"}
						onOpenChange={(value) => setOpen(value ? "auto" : null)}
					>
						<PopoverTrigger asChild>
							<button type="button" className={actionClass} disabled={busy}>
								<LuClock3 className="size-3.5" aria-hidden />
								Auto-continue at reset
							</button>
						</PopoverTrigger>
						<PopoverContent
							side="top"
							align="start"
							className="w-72 max-w-[calc(100vw-2rem)] space-y-3 rounded-xl p-4 text-xs"
						>
							<p className="text-sm font-semibold">
								Pick up after the limit resets
							</p>
							<p className="leading-relaxed text-muted-foreground">
								{reset
									? `One continuation will be sent after ${reset}, using this conversation and account.`
									: "We'll check the account for its reset time before scheduling a continuation."}
							</p>
							<p className="leading-relaxed text-muted-foreground">
								Keep GatedSpace open and your computer awake. You can switch
								tabs. If your computer sleeps, it will try when it wakes.
								Closing the app or session cancels this.
							</p>
							<p className="leading-relaxed text-muted-foreground">
								Sending a message or pressing Stop cancels the schedule. It
								won't repeatedly retry if the account is still blocked.
							</p>
							<div className="flex justify-end gap-2">
								<button
									type="button"
									className={actionClass}
									onClick={() => setOpen(null)}
								>
									Cancel
								</button>
								<button
									type="button"
									className={
										actionClass +
										" bg-primary text-primary-foreground hover:bg-primary/90"
									}
									disabled={busy}
									onClick={() => void run(() => onAutoContinue(true))}
								>
									{pending ? "Checking…" : "Enable auto-continue"}
								</button>
							</div>
						</PopoverContent>
					</Popover>
				)}
			</div>
			{(error || recovery.error) && (
				<p
					role="alert"
					className="mt-2 break-words select-text cursor-text text-destructive"
				>
					{error || recovery.error}
				</p>
			)}
		</section>
	);
}
