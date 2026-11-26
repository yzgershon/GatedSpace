import { useEffect, useState } from "react";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { releaseHighlightsFor } from "shared/release-highlights";
import { ReleaseGallery } from "./components/ReleaseGallery/ReleaseGallery";

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
			/* Storage is optional. */
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
		if (!next && version && !isDev) {
			try {
				localStorage.setItem(STORAGE_KEY, version);
			} catch {
				/* Do not block work. */
			}
		}
	};
	return (
		<ReleaseGallery
			open={open}
			onOpenChange={changeOpen}
			version={version ?? ""}
			entries={entries}
		/>
	);
}
