import { Button } from "@superset/ui/button";
import { Label } from "@superset/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@superset/ui/select";
import { toast } from "@superset/ui/sonner";
import { Switch } from "@superset/ui/switch";
import { useState } from "react";
import { useCopyToClipboard } from "renderer/hooks/useCopyToClipboard";
import { electronTrpc } from "renderer/lib/electron-trpc";

type BindingMode = "lan" | "tailscale" | "tailscale-serve" | "loopback";

/**
 * Each mode's one-line trade-off, because the choice is about who can reach a
 * thing that drives an agent, and that should not need looking up.
 */
const MODE_DESCRIPTIONS: Record<BindingMode, string> = {
	lan: "Same Wi-Fi as this computer. Nothing to set up, but everyone on that network can reach it — the link is the only thing stopping them, and it travels unencrypted.",
	tailscale:
		"Anywhere, over your tailnet. Invisible to whatever network you are on, but both devices need Tailscale.",
	"tailscale-serve":
		"Like Tailscale, but encrypted with a real certificate — the only mode where the phone's voice button works, since browsers need HTTPS for a microphone. Needs HTTPS turned on once in the Tailscale admin console.",
	loopback: "This computer only. For putting your own tunnel in front of it.",
};

const MODE_LABELS: Record<BindingMode, string> = {
	lan: "Local network",
	tailscale: "Tailscale",
	"tailscale-serve": "Tailscale (HTTPS)",
	loopback: "This computer only",
};

export function MobileBridgeSetting() {
	const utils = electronTrpc.useUtils();
	const { copyToClipboard } = useCopyToClipboard();
	const { data: status, isLoading } =
		electronTrpc.mobileBridge.status.useQuery();

	// The picker is local until the bridge starts: the mode only takes effect at
	// bind time, and a stored value that disagrees with the running server would
	// be the more confusing thing to show.
	const [mode, setMode] = useState<BindingMode>("lan");
	const activeMode = (status?.mode as BindingMode | undefined) ?? mode;

	const start = electronTrpc.mobileBridge.start.useMutation({
		onSuccess: (result) => {
			utils.mobileBridge.status.setData(undefined, result);
			if (!result.running && result.error) {
				toast.error("Couldn't start phone access", {
					description: result.error,
				});
			}
		},
		onSettled: () => utils.mobileBridge.status.invalidate(),
	});

	const stop = electronTrpc.mobileBridge.stop.useMutation({
		onSuccess: (result) => utils.mobileBridge.status.setData(undefined, result),
		onSettled: () => utils.mobileBridge.status.invalidate(),
	});

	const revoke = electronTrpc.mobileBridge.revokeToken.useMutation({
		onSuccess: (result) => {
			utils.mobileBridge.status.setData(undefined, result);
			toast.success("Devices unpaired", {
				description: "Open the new link on any phone you still want to use.",
			});
		},
		onError: (error) =>
			toast.error("Couldn't unpair", { description: error.message }),
		onSettled: () => utils.mobileBridge.status.invalidate(),
	});

	const running = status?.running ?? false;
	const pending = start.isPending || stop.isPending || revoke.isPending;

	/**
	 * Switching mode while running restarts the bridge on the new one.
	 *
	 * The picker used to be DISABLED whenever the bridge was up, on the
	 * reasoning that the mode only takes effect at bind time. In use that reads
	 * as "this setting is locked", with nothing saying the switch above has to
	 * go off first — and the one mode people most need to reach (Tailscale
	 * HTTPS, the only one where the phone's microphone works) was exactly the
	 * one they could not select. Restarting is what they meant anyway.
	 */
	const changeMode = async (next: BindingMode) => {
		setMode(next);
		if (!running) return;
		// Sequential, not parallel: the new listener must not race the old one
		// for a port, and in tailscale-serve mode the stop also has to tear down
		// the serve mapping before a new one replaces it.
		await stop.mutateAsync();
		await start.mutateAsync({ mode: next });
	};

	return (
		<div className="space-y-3">
			<div className="flex items-center justify-between">
				<div className="space-y-0.5 pr-4">
					<Label htmlFor="mobile-bridge" className="text-sm font-medium">
						Phone access
					</Label>
					<p className="text-xs text-muted-foreground">
						Read your Claude sessions and send prompts from your phone. Turning
						it off invalidates the link.
					</p>
				</div>
				<Switch
					id="mobile-bridge"
					checked={running}
					disabled={isLoading || pending}
					onCheckedChange={(next) =>
						next ? start.mutate({ mode }) : stop.mutate()
					}
				/>
			</div>

			<div className="flex items-start justify-between gap-4">
				<p className="flex-1 text-xs text-muted-foreground">
					{MODE_DESCRIPTIONS[activeMode]}
				</p>
				<Select
					value={activeMode}
					disabled={pending}
					onValueChange={(value) => void changeMode(value as BindingMode)}
				>
					<SelectTrigger className="w-[180px] shrink-0">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{(Object.keys(MODE_LABELS) as BindingMode[]).map((value) => (
							<SelectItem key={value} value={value}>
								{MODE_LABELS[value]}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>

			{running && status?.url ? (
				<div className="rounded-md border border-border bg-muted/40 p-3">
					<p className="mb-2 text-xs text-muted-foreground">
						Open this on your phone. It carries the access token, so treat it
						like a password.
					</p>
					{status.secure ? (
						<p className="mb-2 text-xs text-success">
							Encrypted, and the phone's voice button is available.
						</p>
					) : (
						// Worth saying plainly. On an unencrypted link the token is
						// readable by anyone capturing traffic on that network, and the
						// voice button cannot appear no matter what the phone supports.
						<p className="mb-2 text-xs text-warning">
							Unencrypted. Anyone on this network who captures traffic can read
							the token, and the phone's voice button stays hidden.
						</p>
					)}
					<div className="flex items-center gap-2">
						<code className="min-w-0 flex-1 truncate font-mono text-[11px]">
							{status.url}
						</code>
						<Button
							size="sm"
							variant="secondary"
							onClick={() => {
								copyToClipboard(status.url ?? "");
								toast.success("Link copied");
							}}
						>
							Copy
						</Button>
					</div>
					{/*
					 * The link stays valid forever once opened, because the token
					 * survives restarts so a phone pairs once. That is the right
					 * default and it needs an undo — without one, a lost phone or a
					 * link sent to someone keeps working with no way to take it back.
					 */}
					<div className="flex items-center justify-between gap-2 pt-1">
						<p className="text-xs text-muted-foreground">
							Anyone who opened this link still has access.
						</p>
						<Button
							size="sm"
							variant="ghost"
							disabled={pending}
							onClick={() => revoke.mutate()}
						>
							Unpair devices
						</Button>
					</div>
				</div>
			) : null}

			{!running && status?.error ? (
				<p className="text-xs text-destructive">{status.error}</p>
			) : null}
		</div>
	);
}
