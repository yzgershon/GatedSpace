/**
 * The one account picker, mounted once for the whole app.
 *
 * `/swap` is accepted from a session composer, from a terminal's keystrokes and
 * from the command palette. A session pane answers it inline (the swap happens
 * where you can watch it), and everything else lands here — one dialog, one
 * list, one place to add an account, so there is no longer a second route that
 * changes a different thing under the same name.
 */
import { toast } from "@superset/ui/sonner";
import { useCallback, useEffect, useRef } from "react";
import { electronTrpcClient } from "renderer/lib/trpc-client";
import { useClaudeAccountSwap } from "renderer/stores/claude-account-swap";
import { matchSwapCandidate } from "shared/claude-account/swap-command";
import { AccountSwapDialog } from "./AccountSwapDialog";
import { useClaudeAccounts } from "./useClaudeAccounts";

export function ClaudeAccountSwapHost() {
	const target = useClaudeAccountSwap((s) => s.target);
	const tick = useClaudeAccountSwap((s) => s.tick);
	const close = useClaudeAccountSwap((s) => s.close);

	// Only the "default" scope reaches this dialog — a session pane answers
	// `/swap` in its own palette, where the swap is visible in the transcript.
	const requested = target?.kind === "default";
	const state = useClaudeAccounts(requested);

	// Re-read on every request, not just the first: an account can be added, or
	// burn through its quota, between two opens.
	const { refresh } = state;
	// biome-ignore lint/correctness/useExhaustiveDependencies: `tick` is the point — re-read on every /swap, not only the first
	useEffect(() => {
		if (requested) void refresh();
	}, [requested, tick, refresh]);

	const setMode = useCallback(
		async (mode: string, label: string) => {
			close();
			try {
				await electronTrpcClient.usage.setClaudeProfileMode.mutate({ mode });
				toast.success(`New agents will use ${label}`, {
					// Said plainly, because the old submenu did exactly this and let
					// people believe their open panes had moved.
					description:
						"Panes and terminals already running keep the account they started on.",
				});
			} catch (error) {
				toast.error("Couldn't switch account", {
					description: error instanceof Error ? error.message : undefined,
				});
			}
		},
		[close],
	);

	/*
	 * `/swap amitai` never opens anything — the name IS the choice.
	 *
	 * Keyed on the request tick so the same name typed twice applies twice, and
	 * guarded so one request can only resolve once: the accounts arrive
	 * asynchronously, so this effect necessarily runs again when they land.
	 */
	const resolvedTick = useRef<number>(-1);
	const query = target?.kind === "default" ? target.query : undefined;
	useEffect(() => {
		if (!requested || !query) return;
		if (state.accounts.length === 0) return;
		if (resolvedTick.current === tick) return;
		const picked = matchSwapCandidate(state.accounts, query);
		if (!picked) return; // Ambiguous or unknown: fall through to the picker.
		resolvedTick.current = tick;
		void setMode(picked.id, picked.label);
	}, [requested, query, tick, state.accounts, setMode]);

	if (target?.kind === "codex")
		return (
			<AccountSwapDialog
				key={tick}
				onClose={close}
				initialProvider="codex"
				paneKey={target.paneKey}
			/>
		);
	if (!requested || (query && resolvedTick.current !== tick && state.loading))
		return null;
	return (
		<AccountSwapDialog
			key={tick}
			onClose={close}
			initialProvider={target.from === "terminal" ? "claude" : undefined}
		/>
	);
}
