/**
 * The way out of a spent account, offered where the session actually stopped.
 *
 * THE FLOW THIS REPLACES was five steps and two of them were guesses. Hitting
 * a limit mid-task meant: press stop, check the Recent Sessions list and hope
 * the row showing there was the same conversation as the pane in front of you,
 * close the tab, change the global account, reopen the session from that list
 * so the next spawn would pick up the new account, restart, then type
 * "continue". Two of those steps existed only to work around the account being
 * a global default rather than a property of the pane — and if the recent-list
 * row was a different session, which nothing told you, the whole sequence
 * silently resumed the wrong conversation.
 *
 * Now it is: stop, pick an account here, type continue. The pane keeps its
 * identity the entire time; nothing is closed and nothing has to be found again.
 *
 * IT SITS NEXT TO "RESTART SESSION" BECAUSE THAT IS THE MOMENT IT IS WANTED.
 * A picker in the chrome would be a setting you go looking for; this is the
 * button under the reply that just got cut off.
 *
 * The usage bars are the point of the menu, not decoration. Choosing the
 * account to move onto used to be blind — the commonest way to waste the whole
 * gesture was landing on an account that was also nearly spent, and finding out
 * one prompt later.
 */
import { Popover, PopoverContent, PopoverTrigger } from "@superset/ui/popover";
import { useEffect, useState } from "react";
import { LuUserRoundCheck } from "react-icons/lu";
import {
	AccountSwapList,
	type ClaudeAccount,
	useClaudeAccounts,
} from "renderer/components/ClaudeAccountSwap";

export function ResumeWithAccount({
	pinnedAccountId,
	runningConfigDir,
	onPick,
}: {
	pinnedAccountId?: string | null;
	/** What the pane's process was actually spawned with. */
	runningConfigDir?: string | null;
	onPick: (account: ClaudeAccount) => void;
}) {
	const [open, setOpen] = useState(false);
	const state = useClaudeAccounts();
	const { refresh } = state;

	/*
	 * Re-read on every open, not once on mount.
	 *
	 * The percentages are the reason to open this, and the reason you are
	 * opening it is that one of them just moved. A list rendered from whatever
	 * was true when the pane mounted would show the account you are trying to
	 * leave as having plenty left.
	 */
	useEffect(() => {
		if (open) void refresh();
	}, [open, refresh]);

	// One account is not a choice, and offering it invites the click that
	// discovers that.
	if (state.accounts.length < 2) return null;

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<button
					type="button"
					className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs text-foreground transition-colors duration-100 hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
				>
					<LuUserRoundCheck className="size-3.5 opacity-70" />
					Resume with another account
				</button>
			</PopoverTrigger>
			<PopoverContent
				// Above the composer it sits over, and anchored to the button rather
				// than centred in the pane, so it opens where the eye already is.
				align="start"
				side="top"
				className="w-[22rem] p-0"
			>
				<div className="max-h-[22rem] overflow-y-auto">
					<AccountSwapList
						state={state}
						scope="session"
						// The pin if there is one, otherwise the account the process is
						// genuinely on — resolved from the dir it spawned with, never
						// from the global default.
						pinnedId={
							pinnedAccountId ??
							state.accounts.find((a) => a.configDir === runningConfigDir)
								?.id ??
							null
						}
						onPick={(account) => {
							setOpen(false);
							onPick(account);
						}}
					/>
				</div>
			</PopoverContent>
		</Popover>
	);
}
