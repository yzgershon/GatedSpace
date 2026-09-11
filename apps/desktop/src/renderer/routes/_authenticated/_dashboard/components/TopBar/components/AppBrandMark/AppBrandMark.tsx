/**
 * The app's name and which build it is.
 *
 * No logo. The first version drew a gradient square to the left of the name,
 * copying the reference's logo slot — but the reference's mark is a brand, and
 * an abstract orange block that stands for nothing is a coloured rectangle in
 * the corner of your own window.
 *
 * Extracted from the sidebar's brand row because the two skins put it in
 * different places: `shellChrome: "sidebar"` keeps it at the top of the
 * sidebar, `"topbar"` moves it into the title bar so the sidebar can start
 * BELOW that bar and line up with the pane cards. Same mark either way, so it
 * lives in one file rather than being spelled twice and drifting.
 */
import { electronTrpc } from "renderer/lib/electron-trpc";

export function AppBrandMark() {
	const { data: appVersion } = electronTrpc.diagnostics.appVersion.useQuery();

	return (
		<>
			<span className="shrink-0 font-medium text-[18px] tracking-tight">
				GatedSpace
			</span>
			{appVersion && (
				<span
					className="no-drag shrink-0 select-text rounded-md border border-border/70 bg-muted/40 px-2 py-1 font-mono text-[12.5px] text-muted-foreground/80 leading-[14px]"
					title={
						appVersion.isDev
							? "Development build"
							: `GatedSpace ${appVersion.version}`
					}
				>
					v{appVersion.version}
					{appVersion.isDev ? " dev" : ""}
				</span>
			)}
		</>
	);
}
