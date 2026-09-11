/**
 * The sidebar's brand row: the app's name, which build it is, and the collapse
 * toggle.
 *
 * No mark. The first version drew a gradient square to the left of the name,
 * copying the reference's logo slot — but the reference's mark is a brand, and
 * an abstract orange block that stands for nothing is just a coloured rectangle
 * in the corner of your own window.
 *
 * The version sits here rather than beside the workspace name in the top bar.
 * "Which build am I running" is a question about the APP, so it belongs next to
 * the app's name; up in the breadcrumb it was competing with the thing that
 * changes every time you switch workspace. This also frees the top bar to be
 * about where you are rather than what you are.
 *
 * The live workspace count that used to sit here is gone with it: the
 * "Workspaces" nav row directly below already carries that number, and printing
 * it twice, eight pixels apart, made neither of them mean anything.
 */
import { ZoomStable } from "renderer/components/ZoomStable";
import { useZoomFactor } from "renderer/hooks/useZoomFactor";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { NavigationControls } from "renderer/routes/_authenticated/_dashboard/components/NavigationControls";
import { SidebarToggle } from "renderer/routes/_authenticated/_dashboard/components/SidebarToggle";
import { AppBrandMark } from "renderer/routes/_authenticated/_dashboard/components/TopBar/components/AppBrandMark";

export function DashboardSidebarBrand() {
	const { data: platform } = electronTrpc.window.getPlatform.useQuery();
	// Default to Mac while loading so we don't briefly cover the traffic lights.
	const isMac = platform === undefined || platform === "darwin";
	const zoomFactor = useZoomFactor();

	return (
		<div
			className="drag flex h-12 shrink-0 items-center gap-2 pr-2"
			// The traffic-light inset and the row height are counter-scaled so the
			// fixed macOS lights stay aligned under page zoom — the same rule the
			// old header row followed, kept because the window chrome has not
			// changed just because what sits beside it has.
			style={
				isMac
					? {
							paddingLeft: `${80 / zoomFactor}px`,
							height: `${48 / zoomFactor}px`,
						}
					: { paddingLeft: "12px" }
			}
		>
			<AppBrandMark />
			<ZoomStable enabled={isMac} className="ml-auto flex items-center gap-1.5">
				<NavigationControls />
				<SidebarToggle />
			</ZoomStable>
		</div>
	);
}
