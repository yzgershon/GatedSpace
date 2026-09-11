/**
 * Declaring a second (or third) Claude account.
 *
 * Adding one only creates its config dir and records it. The sign-in is the
 * Claude CLI's own login flow, which runs by itself the first time an agent
 * starts under an account with no credentials — so the instructions here say
 * "start an agent", not "paste this command".
 *
 * Moved out of the profile dropdown's submenu when `/swap` became the single
 * way to change accounts: this is reached from the swap picker now, so there is
 * one path in rather than one per menu.
 *
 * Uses the tRPC PROXY client rather than the React hooks, for the same reason
 * `useClaudeAccounts` does — the picker is opened from inside the v2 workspace
 * tree, where the electronTrpc hooks hit the "No procedure found" context
 * hijack.
 */
import { Button } from "@superset/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@superset/ui/dialog";
import { Input } from "@superset/ui/input";
import { useState } from "react";
import { electronTrpcClient } from "renderer/lib/trpc-client";

export function AddClaudeAccountDialog({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const [label, setLabel] = useState("");
	const [addedLabel, setAddedLabel] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const close = (next: boolean) => {
		onOpenChange(next);
		if (!next) {
			setAddedLabel(null);
			setLabel("");
			setError(null);
			setPending(false);
		}
	};

	const submit = () => {
		const trimmed = label.trim();
		if (!trimmed || pending) return;
		setPending(true);
		setError(null);
		electronTrpcClient.usage.addClaudeProfile
			.mutate({ label: trimmed })
			.then((result) => {
				setAddedLabel(result.profile.label);
				setLabel("");
			})
			.catch((err: unknown) => {
				setError(
					err instanceof Error ? err.message : "Couldn't add the account.",
				);
			})
			.finally(() => setPending(false));
	};

	return (
		<Dialog open={open} onOpenChange={close}>
			<DialogContent className="sm:max-w-md">
				{addedLabel ? (
					<>
						<DialogHeader>
							<DialogTitle>“{addedLabel}” is ready to sign in</DialogTitle>
							<DialogDescription>
								New agents will use this account from now on.
							</DialogDescription>
						</DialogHeader>
						<ol className="ml-4 list-decimal space-y-2 text-muted-foreground text-sm">
							<li>Open any workspace and start a Claude agent.</li>
							<li>
								Claude Code has no credentials for this account yet, so it runs
								its own login — follow the browser prompt to sign in.
							</li>
							<li>
								Switch any time by typing{" "}
								<span className="font-mono text-foreground">/swap</span> in a
								Claude pane or a terminal.
							</li>
						</ol>
						<DialogFooter>
							<Button onClick={() => close(false)}>Done</Button>
						</DialogFooter>
					</>
				) : (
					<>
						<DialogHeader>
							<DialogTitle>Add a Claude account</DialogTitle>
							<DialogDescription>
								Use more than one Claude subscription on this machine. Each
								account keeps its own login and its own usage limits.
							</DialogDescription>
						</DialogHeader>
						<div className="space-y-2">
							<Input
								autoFocus
								value={label}
								onChange={(e) => setLabel(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === "Enter") submit();
								}}
								placeholder="Account name (e.g. Personal, Work)"
								maxLength={40}
							/>
							{error ? (
								<p className="text-destructive text-xs">{error}</p>
							) : null}
						</div>
						<DialogFooter>
							<Button variant="ghost" onClick={() => close(false)}>
								Cancel
							</Button>
							<Button onClick={submit} disabled={!label.trim() || pending}>
								{pending ? "Adding…" : "Add account"}
							</Button>
						</DialogFooter>
					</>
				)}
			</DialogContent>
		</Dialog>
	);
}
