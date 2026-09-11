/**
 * Which Claude account this pane is running on, in both pane menus.
 *
 * The reason this exists is the reason `/swap` exists. Before it, the only
 * statement about accounts anywhere in the window was a submenu that named the
 * GLOBAL setting — a default for the next process, not a fact about anything
 * you were looking at. Under "auto" it did not even name an account. So there
 * was no way to answer "which account is this pane on?", and consequently no
 * way to tell a real switch from one that had only registered in the UI.
 *
 * **IT NAMES THE PROCESS'S OWN ACCOUNT, NEVER THE CURRENT DEFAULT.** The first
 * version fell back to the globally resolved account whenever a pane had no
 * pin. That is correct at the instant of spawn and wrong from then on: changing
 * the account from the profile menu writes a new default, the chip re-reads it
 * and renames itself, while the process it describes is still on the old
 * account with the old quota. It made the exact failure this chip was added to
 * expose look like a success. `accountConfigDir` is what main actually spawned
 * with, reported back, so the chip states a fact.
 *
 * Shown for every identified running account, including a single account.
 */
import { cn } from "@superset/ui/utils";
import { useSyncExternalStore } from "react";
import { LuUserRound } from "react-icons/lu";
import { useClaudeAccounts } from "renderer/components/ClaudeAccountSwap";
import { getSessionSnapshot, subscribeSession } from "./sessionStore";

export function SessionAccountChip({ paneId }: { paneId: string }) {
	const configDir = useSyncExternalStore(
		(callback) => subscribeSession(paneId, callback),
		() => getSessionSnapshot(paneId).accountConfigDir,
	);
	const { accounts } = useClaudeAccounts();

	/*
	 * Matched on the config dir, not an id, because that is the only thing the
	 * spawn and the account list genuinely share — the id is our label for a
	 * directory, and the process was handed the directory.
	 */
	const account = configDir
		? accounts.find((a) => a.configDir === configDir)
		: undefined;
	// Nothing has spawned yet, or it spawned onto a directory no configured
	// account claims. Either way the honest chip is no chip.
	if (!account) return null;

	return (
		<span
			className={cn(
				"mx-1 mb-1 flex min-w-0 items-center gap-2 rounded-md border px-3 py-2 text-sm",
				account.exhausted
					? "border-destructive/50 bg-destructive/10 text-destructive"
					: "border-border/70 bg-muted/40 text-muted-foreground/80",
			)}
			title={
				`Running on the ${account.label} account${
					account.email ? ` (${account.email})` : ""
				}${account.exhausted ? " — out of quota" : ""}` +
				". Type /swap to move this conversation."
			}
		>
			<LuUserRound className="size-4 shrink-0 opacity-70" />
			<span className="min-w-0 truncate">Account: {account.label}</span>
		</span>
	);
}
