/**
 * Legacy v1 workspace index — now a redirect.
 *
 * See the sibling `$workspaceId` route for why these survive as redirects
 * rather than being deleted outright.
 */
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/_dashboard/workspace/")({
	beforeLoad: () => {
		// The v2 index owns "restore the last viewed workspace, else show the
		// projects list", so this hands off instead of duplicating that logic.
		throw redirect({ to: "/v2-workspace", replace: true });
	},
});
