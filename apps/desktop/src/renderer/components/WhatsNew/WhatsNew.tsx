import { Button } from "@superset/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@superset/ui/dialog";
import { Check, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { releaseHighlightsFor } from "shared/release-highlights";

const STORAGE_KEY = "gatedspace:whats-new:seen-version";
export const OPEN_WHATS_NEW = "gatedspace:open-whats-new";

export function WhatsNew() {
	const { data: appVersion } = electronTrpc.diagnostics.appVersion.useQuery();
	const version = appVersion?.version;
	const isDev = appVersion?.isDev;
	const [open, setOpen] = useState(false);
	const [entries, setEntries] = useState<
		ReturnType<typeof releaseHighlightsFor>
	>([]);
	useEffect(() => {
		if (!version) return;
		let seen: string | null = null;
		try {
			seen = localStorage.getItem(STORAGE_KEY);
		} catch {
			/* Session-only when storage is unavailable. */
		}
		const unread = releaseHighlightsFor(version, seen);
		setEntries(unread);
		setOpen(!isDev && unread.length > 0);
		const show = () => {
			setEntries(releaseHighlightsFor(version));
			setOpen(true);
		};
		window.addEventListener(OPEN_WHATS_NEW, show);
		return () => window.removeEventListener(OPEN_WHATS_NEW, show);
	}, [version, isDev]);
	const changeOpen = (next: boolean) => {
		setOpen(next);
		if (!next && appVersion && !appVersion.isDev) {
			try {
				localStorage.setItem(STORAGE_KEY, appVersion.version);
			} catch {
				/* Do not block the app. */
			}
		}
	};
	return (
		<Dialog open={open} onOpenChange={changeOpen}>
			<DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-[520px]">
				<DialogHeader>
					<Sparkles className="mb-3 size-6 text-primary" aria-hidden="true" />
					<DialogTitle>What’s new in GatedSpace</DialogTitle>
					<DialogDescription>Version {appVersion?.version}</DialogDescription>
				</DialogHeader>
				<div className="space-y-6 py-2">
					{entries.length ? (
						entries.map((entry) => (
							<section key={entry.version}>
								<h3 className="mb-4 text-sm font-medium">{entry.title}</h3>
								<ul className="space-y-4">
									{entry.changes.map((change) => (
										<li key={change.title} className="flex gap-3">
											<Check
												className="mt-0.5 size-4 shrink-0 text-primary"
												aria-hidden="true"
											/>
											<div>
												<h4 className="text-sm font-medium">{change.title}</h4>
												<p className="mt-1 text-sm leading-relaxed text-muted-foreground">
													{change.detail}
												</p>
											</div>
										</li>
									))}
								</ul>
							</section>
						))
					) : (
						<p className="text-sm text-muted-foreground">
							You’re running GatedSpace {appVersion?.version}. Release
							highlights will appear here after your next update.
						</p>
					)}
				</div>
				<DialogFooter>
					<Button onClick={() => changeOpen(false)}>
						Back to my workspace
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
