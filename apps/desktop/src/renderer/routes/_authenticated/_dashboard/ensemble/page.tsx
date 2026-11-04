import { createFileRoute } from "@tanstack/react-router";

// Keep previously persisted /ensemble locations working. New visits use the
// dashboard's Flock view so the current workspace and its panes stay mounted.
export const Route = createFileRoute("/_authenticated/_dashboard/ensemble/")({
	// DashboardContent renders the Flock view for legacy locations too.
	component: () => null,
});
