import { Button } from "@superset/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@superset/ui/dialog";
import {
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
} from "@superset/ui/dropdown-menu";
import { Input } from "@superset/ui/input";
import { useState } from "react";
import { HiCheck, HiOutlinePlus, HiOutlineSparkles } from "react-icons/hi2";
import { electronTrpc } from "renderer/lib/electron-trpc";

/**
 * Claude account switcher.
 *
 * Several Claude subscriptions can share one machine: each account gets its
 * own config dir, and GatedSpace points new agents at the chosen one via
 * CLAUDE_CONFIG_DIR. Running agents keep whichever account they started with.
 *
 * This menu is always visible, even with a single account — it is the only
 * discoverable place to add a second one, and hiding it was why nobody knew
 * multi-account support existed.
 */

export function ClaudeAccountSubmenu({
	onAddAccount,
}: {
	onAddAccount: () => void;
}) {
	const utils = electronTrpc.useUtils();
	const { data: profile } = electronTrpc.usage.getClaudeProfile.useQuery();
	const setMode = electronTrpc.usage.setClaudeProfileMode.useMutation({
		onSuccess: () => utils.usage.getClaudeProfile.invalidate(),
	});

	if (!profile) return null;

	const activeLabel =
		profile.profiles.find((p) => p.id === profile.activeProfileId)?.label ??
		profile.activeProfileId;
	const multiple = profile.profiles.length > 1;

	return (
		<DropdownMenuSub>
			<DropdownMenuSubTrigger className="gap-2">
				<HiOutlineSparkles className="size-4" />
				<span>Claude account</span>
				<span className="ml-auto text-xs text-muted-foreground">
					{multiple ? activeLabel : "Add"}
				</span>
			</DropdownMenuSubTrigger>
			<DropdownMenuSubContent className="max-w-72">
				<DropdownMenuLabel className="font-normal text-muted-foreground text-xs">
					New agents use this account
				</DropdownMenuLabel>

				{multiple && (
					<DropdownMenuItem
						onSelect={() => setMode.mutate({ mode: "auto" })}
						className="gap-2"
					>
						<span className="flex-1">
							Auto
							<span className="block text-xs text-muted-foreground">
								Switch to the next account when one runs out
							</span>
						</span>
						{profile.mode === "auto" && (
							<HiCheck className="size-4 text-primary" />
						)}
					</DropdownMenuItem>
				)}

				{profile.profiles.map((entry) => (
					<DropdownMenuItem
						key={entry.id}
						onSelect={() => setMode.mutate({ mode: entry.id })}
						className="gap-2"
					>
						<span className="flex-1">
							{entry.label}
							<span className="block text-xs text-muted-foreground">
								{entry.ready
									? (entry.email ?? "Signed in")
									: "Not signed in yet — open a Claude agent to log in"}
							</span>
						</span>
						{profile.mode === entry.id && (
							<HiCheck className="size-4 text-primary" />
						)}
					</DropdownMenuItem>
				))}

				<DropdownMenuSeparator />
				<DropdownMenuItem
					// Open on the next tick so the closing menu's focus/dismiss cycle
					// finishes first; opening the dialog in the same tick lets that
					// cycle dismiss it immediately (it flashes for a frame).
					onSelect={() => setTimeout(onAddAccount, 0)}
					className="gap-2"
				>
					<HiOutlinePlus className="size-4" />
					<span>Add Claude account…</span>
				</DropdownMenuItem>
			</DropdownMenuSubContent>
		</DropdownMenuSub>
	);
}

/**
 * Adding an account only declares it and creates its config dir. The actual
 * sign-in is the Claude CLI's own login flow, which runs by itself the first
 * time an agent starts under an account with no credentials — so the
 * instructions here are "start an agent", not "paste this command".
 */
export function AddClaudeAccountDialog({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const utils = electronTrpc.useUtils();
	const [label, setLabel] = useState("");
	const [addedLabel, setAddedLabel] = useState<string | null>(null);

	const addAccount = electronTrpc.usage.addClaudeProfile.useMutation({
		onSuccess: (result) => {
			utils.usage.getClaudeProfile.invalidate();
			setAddedLabel(result.profile.label);
			setLabel("");
		},
	});

	const close = (next: boolean) => {
		onOpenChange(next);
		if (!next) {
			setAddedLabel(null);
			setLabel("");
			addAccount.reset();
		}
	};

	const submit = () => {
		const trimmed = label.trim();
		if (trimmed) addAccount.mutate({ label: trimmed });
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
								Switch accounts any time from{" "}
								<span className="text-foreground">Claude account</span> in this
								menu. Pick <span className="text-foreground">Auto</span> to fall
								back to another account when one hits its limit.
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
							{addAccount.isError && (
								<p className="text-destructive text-xs">
									{addAccount.error.message}
								</p>
							)}
						</div>
						<DialogFooter>
							<Button variant="ghost" onClick={() => close(false)}>
								Cancel
							</Button>
							<Button
								onClick={submit}
								disabled={!label.trim() || addAccount.isPending}
							>
								{addAccount.isPending ? "Adding…" : "Add account"}
							</Button>
						</DialogFooter>
					</>
				)}
			</DialogContent>
		</Dialog>
	);
}
