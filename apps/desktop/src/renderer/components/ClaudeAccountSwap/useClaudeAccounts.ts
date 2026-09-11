/**
 * The Claude accounts on this machine, read through the tRPC PROXY client.
 *
 * Not `electronTrpc.useQuery`. The account picker renders inside the v2
 * workspace tree (the session composer's slash palette opens it), and the
 * electronTrpc REACT hooks hit the "No procedure found" context hijack there —
 * the same trap that has bitten this tree before. The proxy client has no
 * provider to be hijacked, so it works from either side of the app, and the
 * picker has to work from both.
 */
import { useCallback, useEffect, useState } from "react";
import { electronTrpcClient } from "renderer/lib/trpc-client";

export interface ClaudeAccount {
	id: string;
	label: string;
	email?: string;
	configDir: string;
	/** Has completed its one-time CLI login. */
	ready: boolean;
	/** Out of quota right now, per the local rate-limit snapshot. */
	exhausted: boolean;
}

/** What one account has burned through, for the picker's readout. */
export interface AccountLimits {
	fiveHourPercent: number | null;
	fiveHourResets: string | null;
	weeklyPercent: number | null;
	weeklyResets: string | null;
}

export interface ClaudeAccountsState {
	/** "auto" or an account id. What a NEW agent starts on. */
	mode: string;
	/** Which account "auto" resolves to right now. Never the word "auto". */
	activeId: string;
	accounts: ClaudeAccount[];
	/** Keyed by account id. Absent while loading, or if the read failed. */
	limits: Record<string, AccountLimits>;
	loading: boolean;
	refresh: () => Promise<void>;
}

export function useClaudeAccounts(enabled = true): ClaudeAccountsState {
	const [state, setState] = useState<{
		mode: string;
		activeId: string;
		accounts: ClaudeAccount[];
		limits: Record<string, AccountLimits>;
	}>({ mode: "auto", activeId: "", accounts: [], limits: {} });
	const [loading, setLoading] = useState(enabled);

	const refresh = useCallback(async () => {
		try {
			/*
			 * Both together, and the limits are allowed to fail on their own.
			 *
			 * The list is what the picker is FOR; the percentages are decoration on
			 * top of it. Awaiting them in series would let a slow read hold up the
			 * rows, and letting a rejection escape would empty a picker that had
			 * everything it needed to be useful.
			 */
			const [profile, limits] = await Promise.all([
				electronTrpcClient.usage.getClaudeProfile.query(),
				electronTrpcClient.usage.allLimits
					.query()
					.catch(() => [] as { id: string }[]),
			]);
			setState({
				mode: profile.mode,
				activeId: profile.activeProfileId,
				accounts: profile.profiles as ClaudeAccount[],
				limits: Object.fromEntries(
					(limits as (AccountLimits & { id: string })[]).map(
						({ id, ...rest }) => [id, rest],
					),
				),
			});
		} catch {
			// Reading a local JSON file. A failure here means the main process is
			// mid-restart; the picker shows what it has and the next open retries.
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		if (!enabled) return;
		setLoading(true);
		void refresh();
	}, [enabled, refresh]);

	return { ...state, loading, refresh };
}
