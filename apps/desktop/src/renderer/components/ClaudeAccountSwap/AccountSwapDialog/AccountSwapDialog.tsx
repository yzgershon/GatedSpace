import { Button } from "@superset/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@superset/ui/dialog";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@superset/ui/select";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { LuCheck, LuChevronRight, LuPlus } from "react-icons/lu";
import { usePresetIcon } from "renderer/assets/app-icons/preset-icons";
import { electronTrpcClient } from "renderer/lib/trpc-client";
import { AccountSignIn } from "../AccountSignIn";

type Provider = "claude" | "codex";

export function AccountSwapDialog({
	onClose,
	initialProvider,
	paneKey,
}: {
	onClose: () => void;
	initialProvider?: Provider;
	paneKey?: string;
}) {
	const icons = {
		claude: usePresetIcon("claude"),
		codex: usePresetIcon("codex"),
	};
	const [provider, setProvider] = useState<Provider | undefined>(
		initialProvider,
	);
	const [scope, setScope] = useState(paneKey || "new");
	const [adding, setAdding] = useState(false);
	const [account, setAccount] = useState<{ id: string; label: string }>();
	const [error, setError] = useState("");
	const [pending, setPending] = useState(false);
	const client = useQueryClient();
	const query = useQuery({
		queryKey: ["agent-accounts", provider],
		queryFn: () =>
			electronTrpcClient.agentAccounts.list.query({
				provider: provider ?? "claude",
			}),
		enabled: !!provider,
		retry: false,
	});
	const pick = async (id: string) => {
		if (!provider) return;
		setPending(true);
		setError("");
		try {
			await electronTrpcClient.agentAccounts.select.mutate({
				provider,
				id,
				key: provider === "codex" && scope !== "new" ? scope : undefined,
			});
			await client.invalidateQueries({ queryKey: ["agent-accounts"] });
			await client.invalidateQueries({ queryKey: ["native-codex-account"] });
			await client.invalidateQueries({ queryKey: ["native-codex-models"] });
			onClose();
		} catch (e) {
			setError(e instanceof Error ? e.message : "Could not switch account.");
		} finally {
			setPending(false);
		}
	};
	const activeId =
		scope === "new"
			? query.data?.activeId
			: query.data?.sessions.find((s) => s.key === scope)?.accountId;
	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open && !pending) onClose();
			}}
		>
			<DialogContent className="gap-4 sm:max-w-[420px]">
				<DialogHeader>
					<DialogTitle>
						{adding
							? `Add ${provider === "codex" ? "Codex" : "Claude Code"} account`
							: "Swap account"}
					</DialogTitle>
					<DialogDescription>
						{adding
							? "Connect your subscription using the official sign-in flow."
							: !provider
								? "Choose the agent whose account you want to switch."
								: scope === "new"
									? "Choose the account for new sessions. Running sessions keep their account."
									: "Continue this conversation with another account. Its history and settings stay with it."}
					</DialogDescription>
				</DialogHeader>
				{!provider ? (
					<div className="space-y-1">
						{(["claude", "codex"] as const).map((p) => (
							<button
								type="button"
								key={p}
								onClick={() => setProvider(p)}
								className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
							>
								<img
									src={icons[p]}
									alt=""
									className="size-5 shrink-0 object-contain"
								/>
								<span className="flex-1 text-left">
									{p === "claude" ? "Claude Code" : "Codex"}
								</span>
								<LuChevronRight className="size-4 text-muted-foreground" />
							</button>
						))}
					</div>
				) : adding ? (
					<AccountSignIn
						key={`${provider}:${account?.id ?? "new"}`}
						provider={provider}
						account={account}
						onDone={() => {
							void query.refetch();
						}}
						onBack={() => {
							setAdding(false);
							setAccount(undefined);
							void query.refetch();
						}}
					/>
				) : (
					<>
						<div className="flex items-center gap-2 text-sm">
							<img
								src={icons[provider]}
								alt=""
								className="size-5 shrink-0 object-contain"
							/>
							<span className="flex-1 font-medium">
								{provider === "claude" ? "Claude Code" : "Codex"}
							</span>
							{!initialProvider && (
								<Button
									variant="ghost"
									size="sm"
									disabled={pending}
									onClick={() => {
										setProvider(undefined);
										setScope("new");
										setError("");
									}}
								>
									Change agent
								</Button>
							)}
						</div>
						{provider === "codex" && (
							<Select value={scope} onValueChange={setScope} disabled={pending}>
								<SelectTrigger aria-label="Apply account to">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="new">New Codex sessions</SelectItem>
									{query.data?.sessions.map((s) => (
										<SelectItem key={s.key} value={s.key}>
											{s.title}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						)}
						<div className="max-h-64 space-y-1 overflow-y-auto">
							{query.isPending && (
								<p className="py-3 text-sm text-muted-foreground">
									Reading accounts…
								</p>
							)}
							{query.data?.accounts.map((a) => (
								<button
									key={a.id}
									type="button"
									disabled={pending}
									onClick={() => {
										if (a.ready) void pick(a.id);
										else {
											setAccount(a);
											setAdding(true);
										}
									}}
									className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
								>
									<span
										className={`size-1.5 shrink-0 rounded-full ${a.ready ? "bg-success" : "bg-muted-foreground"}`}
									/>
									<span className="min-w-0 flex-1">
										<span className="block truncate text-sm font-medium">
											{a.label}
										</span>
										<span className="block truncate text-xs text-muted-foreground">
											{a.ready ? a.detail : "Sign in with browser"}
										</span>
									</span>
									{a.id === activeId && (
										<LuCheck
											className="size-4 text-primary"
											aria-label="Selected account"
										/>
									)}
								</button>
							))}
						</div>
						{pending && (
							<output className="text-xs text-muted-foreground">
								Connecting account…
							</output>
						)}
						{(error || query.error) && (
							<p
								role="alert"
								className="select-text cursor-text text-sm text-destructive"
							>
								{error || query.error?.message}
							</p>
						)}
						{query.isError && (
							<Button variant="outline" onClick={() => void query.refetch()}>
								Retry
							</Button>
						)}
						{provider === "claude" && (
							<p className="text-xs text-muted-foreground">
								To move an open Claude conversation, use /swap in its composer.
							</p>
						)}
						<Button
							variant="outline"
							disabled={pending}
							onClick={() => setAdding(true)}
						>
							<LuPlus className="size-4" />
							Add account
						</Button>
					</>
				)}
			</DialogContent>
		</Dialog>
	);
}
