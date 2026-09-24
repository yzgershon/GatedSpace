import { Button } from "@superset/ui/button";
import { Input } from "@superset/ui/input";
import { useState } from "react";
import { electronTrpc } from "renderer/lib/electron-trpc";

export function SyncTransfersSettings() {
	const utils = electronTrpc.useUtils();
	const status = electronTrpc.continuity.transferStatus.useQuery(undefined, {
		refetchInterval: 3000,
	});
	const sessions = electronTrpc.continuity.sessions.useQuery();
	const remote = electronTrpc.continuity.available.useQuery(undefined, {
		enabled: false,
		retry: false,
	});
	const send = electronTrpc.continuity.send.useMutation();
	const retry = electronTrpc.continuity.retry.useMutation();
	const restore = electronTrpc.continuity.restore.useMutation();
	const automatic = electronTrpc.continuity.automatic.useMutation();
	const syncNow = electronTrpc.continuity.syncNow.useMutation();
	const [selected, setSelected] = useState("");
	const [folderName, setFolderName] = useState("");
	const [restoring, setRestoring] = useState<string | null>(null);
	const [error, setError] = useState("");
	const [notice, setNotice] = useState("");
	const [autoOverrides, setAutoOverrides] = useState<
		Record<string, boolean | undefined>
	>({});
	const busy =
		status.data?.busy ||
		send.isPending ||
		retry.isPending ||
		restore.isPending ||
		syncNow.isPending;
	async function run(action: () => Promise<unknown>) {
		setError("");
		setNotice("");
		try {
			await action();
		} catch (problem) {
			setError(
				problem instanceof Error ? problem.message : "Transfer did not finish.",
			);
		} finally {
			await utils.continuity.transferStatus.invalidate();
		}
	}
	return (
		<section
			aria-label="Synced conversations"
			className="space-y-4 border-t border-border pt-5"
		>
			<div>
				<h4 className="text-sm font-medium">Conversations on your PCs</h4>
				<p className="mt-1 max-w-lg text-xs leading-relaxed text-muted-foreground">
					Select a finished conversation and its Git project. Source files and
					images are encrypted before upload; credentials, ignored files, and
					dependencies stay on this PC.
				</p>
			</div>
			<div className="flex flex-wrap gap-2">
				<select
					aria-label="Conversation to sync"
					className="min-w-0 max-w-full flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
					value={selected}
					onChange={(event) => setSelected(event.target.value)}
				>
					<option value="">Choose a conversation</option>
					{sessions.data?.map((session) => (
						<option
							key={`${session.provider}:${session.sessionId}`}
							value={`${session.provider}:${session.sessionId}`}
						>
							{session.provider === "codex" ? "Codex" : "Claude"} ·{" "}
							{session.title}
						</option>
					))}
				</select>
				<Button
					size="sm"
					disabled={busy || !selected}
					onClick={() =>
						void run(async () => {
							const item = sessions.data?.find(
								(session) =>
									`${session.provider}:${session.sessionId}` === selected,
							);
							if (!item) return;
							const result = await send.mutateAsync({
								provider: item.provider,
								sessionId: item.sessionId,
							});
							if (!result.canceled && !result.result?.conflicts.length)
								setNotice(
									"Checkpoint saved. Later completed turns will sync automatically.",
								);
						})
					}
				>
					Choose project & sync
				</Button>
			</div>
			{status.data?.bindings.map((binding) => (
				<div
					key={binding.streamId}
					className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3"
				>
					<div className="min-w-0">
						<p className="truncate text-sm">{binding.title}</p>
						<p className="truncate text-xs text-muted-foreground">
							{binding.provider} · Revision {binding.revision} ·{" "}
							{binding.project}
						</p>
					</div>
					<label className="flex items-center gap-2 text-xs">
						<input
							type="checkbox"
							className="accent-primary"
							checked={autoOverrides[binding.streamId] ?? binding.autoSync}
							disabled={busy || automatic.isPending}
							onChange={(event) => {
								const enabled = event.target.checked;
								setAutoOverrides((previous) => ({
									...previous,
									[binding.streamId]: enabled,
								}));
								void run(async () => {
									try {
										await automatic.mutateAsync({
											streamId: binding.streamId,
											enabled,
										});
										await utils.continuity.transferStatus.invalidate();
									} finally {
										setAutoOverrides((previous) => ({
											...previous,
											[binding.streamId]: undefined,
										}));
									}
								});
							}}
						/>
						Auto-sync
					</label>
					<Button
						size="sm"
						variant="outline"
						disabled={busy}
						onClick={() =>
							void run(async () => {
								const result = await syncNow.mutateAsync({
									streamId: binding.streamId,
								});
								if (!result.conflicts.length)
									setNotice(
										"Checkpoint uploaded. You can continue from it on your other PC.",
									);
							})
						}
					>
						Sync now
					</Button>
				</div>
			))}
			<p className="text-xs leading-relaxed text-muted-foreground">
				Auto-sync checks finished turns every minute while GatedSpace is open.
				Use Sync now before turning off this PC. Storage is limited to 1 GB;
				existing work stays local if an upload cannot finish.
			</p>
			{Boolean(status.data?.queued) && (
				<div className="flex flex-wrap items-center gap-3 text-sm">
					<span>{status.data?.queued} checkpoint(s) waiting to send</span>
					<Button
						size="sm"
						variant="outline"
						disabled={busy}
						onClick={() => void run(() => retry.mutateAsync())}
					>
						Retry transfers
					</Button>
				</div>
			)}
			{Boolean(status.data?.result?.conflicts.length) && (
				<p className="select-text text-sm text-destructive">
					Another PC has newer work. Both versions are preserved. Restore the
					synced version into a new folder before continuing. To upload your old
					local work separately, select its original conversation again.
				</p>
			)}
			<div className="flex items-center justify-between gap-3 pt-2">
				<h4 className="text-sm font-medium">Available from your other PC</h4>
				<Button
					size="sm"
					variant="outline"
					disabled={busy || remote.isFetching}
					onClick={() => void remote.refetch()}
				>
					{remote.isFetching ? "Checking…" : "Refresh"}
				</Button>
			</div>
			{remote.data?.length === 0 && (
				<p className="text-sm text-muted-foreground">
					No uploaded conversations yet. Save a checkpoint on your first PC.
				</p>
			)}
			{remote.data?.map((item) => (
				<div key={item.id} className="rounded-lg border border-border p-3">
					<div className="flex items-center justify-between gap-3">
						<div className="min-w-0">
							<p className="truncate text-sm font-medium">{item.title}</p>
							<p className="text-xs text-muted-foreground">
								{item.provider} · {item.fileCount} files · Revision{" "}
								{item.revision}
							</p>
						</div>
						<Button
							size="sm"
							variant="outline"
							disabled={busy}
							onClick={() => {
								setRestoring(item.id);
								setFolderName(
									`${item.projectName}-synced`.replace(/[^A-Za-z0-9._-]/g, "-"),
								);
							}}
						>
							Restore
						</Button>
					</div>
					{restoring === item.id && (
						<form
							className="mt-3 space-y-2"
							onSubmit={(event) => {
								event.preventDefault();
								void run(async () => {
									const result = await restore.mutateAsync({
										streamId: item.id,
										folderName,
									});
									if (result) {
										setNotice(
											`Restored ${result.title}. Open it from Recent sessions → ${result.provider === "codex" ? "Codex" : "Claude"}.`,
										);
										setRestoring(null);
										await utils.claudeSessions.list.invalidate();
									}
								});
							}}
						>
							<Input
								aria-label="New project folder name"
								value={folderName}
								onChange={(event) => setFolderName(event.target.value)}
							/>
							<p className="text-xs text-muted-foreground">
								Creates a new folder. Your existing project remains untouched.
							</p>
							<Button size="sm" type="submit" disabled={busy || !folderName}>
								Choose destination & restore
							</Button>
						</form>
					)}
				</div>
			))}
			{(error ||
				remote.error?.message ||
				status.error?.message ||
				status.data?.error) && (
				<p
					role="alert"
					className="select-text cursor-text text-sm text-destructive"
				>
					{error ||
						remote.error?.message ||
						status.error?.message ||
						status.data?.error}
				</p>
			)}
			{notice && (
				<output className="block text-sm text-muted-foreground">
					{notice}
				</output>
			)}
		</section>
	);
}
