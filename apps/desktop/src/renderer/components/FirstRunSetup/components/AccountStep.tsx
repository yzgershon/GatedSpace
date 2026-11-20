import { Button } from "@superset/ui/button";
import { useState } from "react";
import { LuArrowUpRight, LuCheck } from "react-icons/lu";
import { electronTrpc } from "renderer/lib/electron-trpc";

export function AccountStep({ onNext }: { onNext: () => void }) {
	const status = electronTrpc.continuity.status.useQuery(undefined, {
		refetchInterval: 2000,
		retry: false,
	});
	const connect = electronTrpc.continuity.connect.useMutation();
	const open = electronTrpc.continuity.openSignIn.useMutation();
	const cancel = electronTrpc.continuity.cancel.useMutation();
	const [error, setError] = useState("");
	const busy = connect.isPending || open.isPending || cancel.isPending;
	const data = status.data;
	async function run(action: () => Promise<unknown>) {
		setError("");
		try {
			await action();
		} catch (e) {
			setError(
				e instanceof Error ? e.message : "Could not connect. Try again.",
			);
		} finally {
			void status.refetch();
		}
	}
	return (
		<div className="space-y-5">
			<p className="text-sm leading-relaxed text-muted-foreground">
				Create your GatedSpace account, or sign in to the one you already use.
				Choose Google or GitHub in the browser, then approve this computer.
			</p>
			{data?.account?.connected ? (
				<div className="first-run-confirm">
					<LuCheck />
					<div>
						<strong>You're connected</strong>
						<p>{data.account.email}</p>
					</div>
				</div>
			) : data?.pending ? (
				<div className="rounded-xl border border-border p-5 space-y-3">
					<p className="text-sm">Match this code in the browser</p>
					<p className="select-text font-mono text-3xl tracking-[.18em]">
						{data.pending.code}
					</p>
					<p className="text-xs text-muted-foreground">
						Keep GatedSpace open. This step updates when sign-in finishes.
					</p>
					<div className="flex gap-2">
						<Button
							variant="outline"
							disabled={busy}
							onClick={() => void run(() => open.mutateAsync())}
						>
							Open sign-in page <LuArrowUpRight />
						</Button>
						<Button
							variant="ghost"
							disabled={busy}
							onClick={() => void run(() => cancel.mutateAsync())}
						>
							Cancel sign-in
						</Button>
					</div>
				</div>
			) : (
				<Button
					disabled={busy || status.isLoading}
					onClick={() =>
						void run(async () => {
							await connect.mutateAsync();
							await open.mutateAsync();
						})
					}
				>
					{busy ? "Opening sign-in…" : "Create account or sign in"}
					<LuArrowUpRight />
				</Button>
			)}
			{(error || status.error || data?.error) && (
				<div>
					<p
						role="alert"
						className="select-text cursor-text text-sm text-destructive"
					>
						{error || status.error?.message || data?.error}
					</p>
					<Button variant="ghost" onClick={() => void status.refetch()}>
						Recheck connection
					</Button>
				</div>
			)}
			<p className="text-xs leading-relaxed text-muted-foreground">
				Your agent subscriptions connect separately in the next step. Project
				sync stays off until you choose to set it up.
			</p>
			<div className="first-run-footer">
				{data?.account?.connected ? (
					<Button onClick={onNext}>Continue to agents</Button>
				) : (
					<Button
						variant="ghost"
						disabled={busy}
						onClick={() =>
							void run(async () => {
								if (data?.pending) await cancel.mutateAsync();
								onNext();
							})
						}
					>
						Use this PC without an account
					</Button>
				)}
			</div>
		</div>
	);
}
