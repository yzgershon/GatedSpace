import { Button } from "@superset/ui/button";
import { Input } from "@superset/ui/input";
import { useState } from "react";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { SyncTransfersSettings } from "../SyncTransfersSettings";

export function SyncSettings() {
	const utils = electronTrpc.useUtils();
	const status = electronTrpc.continuity.status.useQuery(undefined, {
		refetchInterval: 2000,
	});
	const [key, setKey] = useState("");
	const [showImport, setShowImport] = useState(false);
	const [error, setError] = useState("");
	const [notice, setNotice] = useState("");
	const connect = electronTrpc.continuity.connect.useMutation();
	const open = electronTrpc.continuity.openSignIn.useMutation();
	const cancel = electronTrpc.continuity.cancel.useMutation();
	const disconnect = electronTrpc.continuity.disconnect.useMutation();
	const saveKey = electronTrpc.continuity.setRecoveryKey.useMutation();
	const exportKey = electronTrpc.continuity.exportRecoveryKey.useMutation();
	const busy = [connect, open, cancel, disconnect, saveKey, exportKey].some(
		(mutation) => mutation.isPending,
	);
	async function run(action: () => Promise<unknown>) {
		setError("");
		setNotice("");
		try {
			await action();
		} catch (problem) {
			setError(
				problem instanceof Error
					? problem.message
					: "Sync could not complete this action.",
			);
		} finally {
			await utils.continuity.status.invalidate();
		}
	}
	const data = status.data;
	return (
		<section
			aria-labelledby="sync-settings-title"
			className="mt-8 border-t border-border pt-6"
		>
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div>
					<h3
						id="sync-settings-title"
						className="text-base font-semibold tracking-tight"
					>
						GatedSpace Sync
					</h3>
					<p className="mt-1 max-w-lg text-sm leading-relaxed text-muted-foreground">
						Connect your PCs with a private account. Each PC keeps its own
						Claude and Codex sign-in.
					</p>
				</div>
				{data?.account?.connected && (
					<span className="rounded-md bg-muted px-2.5 py-1 text-xs">
						Connected
					</span>
				)}
			</div>
			{status.isLoading && (
				<p className="mt-4 text-sm text-muted-foreground">
					Checking this computer’s connection…
				</p>
			)}
			{data && (
				<div className="mt-5 space-y-4">
					<div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-muted/20 p-4">
						<div className="min-w-0">
							<p className="truncate text-sm font-medium">
								{data.account?.email || "This computer is not connected"}
							</p>
							<p className="mt-1 text-xs text-muted-foreground">
								{data.deviceName} · Private hosted sync
							</p>
						</div>
						{data.account?.connected ? (
							<Button
								variant="outline"
								size="sm"
								disabled={busy}
								onClick={() => void run(() => disconnect.mutateAsync())}
							>
								Disconnect
							</Button>
						) : (
							!data.pending && (
								<Button
									size="sm"
									disabled={busy}
									onClick={() =>
										void run(async () => {
											await connect.mutateAsync();
											await open.mutateAsync();
										})
									}
								>
									Connect account
								</Button>
							)
						)}
					</div>
					{data.pending && (
						<div className="rounded-xl border border-border p-4">
							<p className="text-sm">Approve this code in your browser</p>
							<p className="my-3 select-text font-mono text-2xl tracking-widest">
								{data.pending.code}
							</p>
							<p className="mb-3 text-xs text-muted-foreground">
								Only approve if the browser shows this same code. This screen
								updates automatically.
							</p>
							<div className="flex gap-2">
								<Button
									size="sm"
									variant="outline"
									disabled={busy}
									onClick={() => void run(() => open.mutateAsync())}
								>
									Open sign-in
								</Button>
								<Button
									size="sm"
									variant="ghost"
									disabled={busy}
									onClick={() => void run(() => cancel.mutateAsync())}
								>
									Cancel
								</Button>
							</div>
						</div>
					)}
					{data.account?.connected && (
						<div className="space-y-3">
							<p className="text-sm font-medium">Recovery key</p>
							<p className="max-w-lg text-sm leading-relaxed text-muted-foreground">
								{data.account.hasRecoveryKey
									? "Your key is protected by this computer’s operating system. Save a private copy to unlock synced work on your other PC."
									: "Use the same recovery key on both PCs. GatedSpace’s server cannot read your encrypted conversations or project files."}
							</p>
							{data.account.hasRecoveryKey ? (
								<Button
									size="sm"
									variant="outline"
									disabled={busy}
									onClick={() =>
										void run(async () => {
											const result = await exportKey.mutateAsync();
											if (result.saved)
												setNotice("Recovery key saved. Keep the file private.");
										})
									}
								>
									Save recovery key
								</Button>
							) : (
								<>
									<div className="flex flex-wrap gap-2">
										<Button
											size="sm"
											disabled={busy}
											onClick={() => void run(() => saveKey.mutateAsync({}))}
										>
											Set up my first PC
										</Button>
										<Button
											size="sm"
											variant="outline"
											disabled={busy}
											onClick={() => setShowImport(!showImport)}
										>
											I have a recovery key
										</Button>
									</div>
									{showImport && (
										<form
											className="flex flex-wrap gap-2"
											onSubmit={(event) => {
												event.preventDefault();
												void run(async () => {
													await saveKey.mutateAsync({ key });
													setKey("");
													setShowImport(false);
												});
											}}
										>
											<Input
												aria-label="Recovery key"
												type="password"
												autoComplete="off"
												spellCheck={false}
												value={key}
												onChange={(event) => setKey(event.target.value)}
												placeholder="Enter the key from your other PC"
												className="max-w-sm font-mono"
											/>
											<Button
												type="submit"
												size="sm"
												disabled={busy || key.trim().length !== 43}
											>
												Unlock
											</Button>
										</form>
									)}
								</>
							)}
						</div>
					)}
					{data.account?.connected && data.account.hasRecoveryKey && (
						<SyncTransfersSettings />
					)}
				</div>
			)}
			{(error || status.error?.message || data?.error) && (
				<p
					role="alert"
					className="mt-4 select-text cursor-text text-sm text-destructive"
				>
					{error || status.error?.message || data?.error}
				</p>
			)}
			{notice && (
				<output className="mt-4 block text-sm text-muted-foreground">
					{notice}
				</output>
			)}
		</section>
	);
}
