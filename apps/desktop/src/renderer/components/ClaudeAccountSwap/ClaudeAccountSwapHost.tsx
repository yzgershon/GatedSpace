/**
 * The one account picker, mounted once for the whole app.
 *
 * `/swap` is accepted from a session composer, from a terminal's keystrokes and
 * from the command palette. A session pane answers it inline (the swap happens
 * where you can watch it), and everything else lands here — one dialog, one
 * list, one place to add an account, so there is no longer a second route that
 * changes a different thing under the same name.
 */
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@superset/ui/dialog";
import { toast } from "@superset/ui/sonner";
import { useCallback, useEffect, useRef, useState } from "react";
import { electronTrpcClient } from "renderer/lib/trpc-client";
import { useClaudeAccountSwap } from "renderer/stores/claude-account-swap";
import { matchSwapCandidate } from "shared/claude-account/swap-command";
import { AccountSwapList } from "./AccountSwapList";
import { AddClaudeAccountDialog } from "./AddClaudeAccountDialog";
import { useClaudeAccounts } from "./useClaudeAccounts";

export function ClaudeAccountSwapHost() {
	const target = useClaudeAccountSwap((s) => s.target);
	const tick = useClaudeAccountSwap((s) => s.tick);
	const close = useClaudeAccountSwap((s) => s.close);
	const [addOpen, setAddOpen] = useState(false);

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

	// Held shut while a named account is still being resolved, so `/swap amitai`
	// does not flash the picker open on its way to doing the thing.
	const open =
		requested && !(query && resolvedTick.current !== tick && state.loading);

	return (
		<>
			<Dialog
				open={open}
				onOpenChange={(next) => {
					if (!next) close();
				}}
			>
				<DialogContent className="gap-2 p-0 sm:max-w-md">
					<DialogHeader className="px-4 pt-4">
						<DialogTitle>Swap Claude account</DialogTitle>
						<DialogDescription>
							{target?.kind === "default" && target.from === "terminal"
								? "This terminal keeps the account it started on — a terminal's environment is fixed when it opens. Pick the account the next agent should use."
								: "Pick the account new agents start on. Type /swap in a Claude pane to move that conversation itself."}
						</DialogDescription>
					</DialogHeader>
					<div className="max-h-[24rem] overflow-y-auto px-1 pb-2">
						<AccountSwapList
							state={state}
							scope="default"
							onPick={(account) => void setMode(account.id, account.label)}
							onPickAuto={() =>
								void setMode("auto", "the next available account")
							}
							onAddAccount={() => {
								close();
								// Next tick, so the closing dialog's focus/dismiss cycle
								// finishes first — otherwise it dismisses the new one in the
								// same frame and it flashes.
								setTimeout(() => setAddOpen(true), 0);
							}}
						/>
					</div>
				</DialogContent>
			</Dialog>
			<AddClaudeAccountDialog
				open={addOpen}
				onOpenChange={(next) => {
					setAddOpen(next);
					if (!next) void refresh();
				}}
			/>
		</>
	);
}
