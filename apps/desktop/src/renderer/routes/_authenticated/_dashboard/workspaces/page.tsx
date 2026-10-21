import { createFileRoute } from "@tanstack/react-router";
import { PublicSetup } from "renderer/components/PublicSetup/PublicSetup";
import { WorkspacesListView } from "renderer/components/WorkspacesListView";
import { isLocalMode } from "renderer/lib/local-mode";

export const Route = createFileRoute("/_authenticated/_dashboard/workspaces/")({
	component: WorkspacesPage,
});

function WorkspacesPage() {
	return isLocalMode() ? <PublicSetup /> : <WorkspacesListView />;
}
