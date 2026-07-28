/**
 * Where the app lands on launch.
 *
 * Previously the root route sent everyone to the v1 index, which restored a v1
 * workspace — and since v1 and v2 disagree, the dashboard layout answered with
 * the "Pick a workspace" placeholder. So every launch ended on a chooser even
 * though the last workspace was known. This is the v2 equivalent, and it
 * restores that workspace instead.
 *
 * `lastViewedWorkspaceId` is shared with the notification focus handler in
 * `_authenticated/layout.tsx`, which writes the same key.
 */
import { Spinner } from "@superset/ui/spinner";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useHostWorkspaces } from "renderer/routes/_authenticated/providers/HostWorkspacesProvider";

export const Route = createFileRoute(
	"/_authenticated/_dashboard/v2-workspace/",
)({ component: V2WorkspaceIndexPage });

function V2WorkspaceIndexPage() {
	const navigate = useNavigate();
	const { workspaces, isReady } = useHostWorkspaces();

	useEffect(() => {
		// `isReady` gates only the EMPTY case: hosts answer at different times, so
		// redirecting to the projects list before they have all reported would
		// bounce someone off a workspace they do have.
		if (!isReady && workspaces.length === 0) return;

		if (workspaces.length === 0) {
			// Nothing to open yet — the projects list carries the "Add repository"
			// entry points.
			navigate({ to: "/workspaces", replace: true });
			return;
		}

		const lastViewedId = localStorage.getItem("lastViewedWorkspaceId");
		const target =
			workspaces.find((workspace) => workspace.id === lastViewedId) ??
			workspaces[0];
		if (!target) return;

		navigate({
			to: "/v2-workspace/$workspaceId",
			params: { workspaceId: target.id },
			replace: true,
		});
	}, [workspaces, isReady, navigate]);

	return (
		<div className="flex h-full w-full items-center justify-center">
			<Spinner className="size-5" />
		</div>
	);
}
