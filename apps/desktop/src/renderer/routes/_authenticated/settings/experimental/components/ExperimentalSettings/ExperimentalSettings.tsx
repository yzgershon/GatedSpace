import { Label } from "@superset/ui/label";
import { Switch } from "@superset/ui/switch";
import {
	useInlineWorkspacePortsEnabled,
	useInlineWorkspacePortsStore,
} from "renderer/stores/inline-workspace-ports";
import {
	useWorkspaceAgentsRowEnabled,
	useWorkspaceAgentsRowStore,
} from "renderer/stores/workspace-agents-row";
import {
	isItemVisible,
	SETTING_ITEM_ID,
	type SettingItemId,
} from "../../../utils/settings-search";

interface ExperimentalSettingsProps {
	visibleItems?: SettingItemId[] | null;
}

export function ExperimentalSettings({
	visibleItems,
}: ExperimentalSettingsProps) {
	// The "Try GatedSpace v2" switch and the "Import from v1" button are gone.
	// Both existed to move between two workspace UIs; there is only one now, and
	// the switch could only ever drop someone into the one being removed.
	const showInlineWorkspacePorts = isItemVisible(
		SETTING_ITEM_ID.EXPERIMENTAL_INLINE_WORKSPACE_PORTS,
		visibleItems,
	);
	const showWorkspaceAgents = isItemVisible(
		SETTING_ITEM_ID.EXPERIMENTAL_WORKSPACE_AGENTS,
		visibleItems,
	);
	const inlineWorkspacePortsEnabled = useInlineWorkspacePortsEnabled();
	const setInlineWorkspacePortsEnabled = useInlineWorkspacePortsStore(
		(state) => state.setEnabled,
	);
	const workspaceAgentsEnabled = useWorkspaceAgentsRowEnabled();
	const setWorkspaceAgentsEnabled = useWorkspaceAgentsRowStore(
		(state) => state.setEnabled,
	);

	return (
		<div className="p-6 max-w-4xl w-full mx-auto">
			<div className="mb-8">
				<h2 className="text-xl font-semibold">Experimental</h2>
				<p className="text-sm text-muted-foreground mt-1">
					Try early access features and previews.
				</p>
			</div>

			<div className="space-y-6">
				{showInlineWorkspacePorts && (
					<div className="flex items-center justify-between gap-6">
						<div className="min-w-0 flex-1 space-y-0.5">
							<Label
								htmlFor="inline-workspace-ports"
								className="text-sm font-medium"
							>
								Inline workspace ports
							</Label>
							<p className="text-xs text-muted-foreground">
								Show detected ports under each workspace in the sidebar instead
								of a single panel at the bottom.
							</p>
						</div>
						<Switch
							id="inline-workspace-ports"
							checked={inlineWorkspacePortsEnabled}
							onCheckedChange={setInlineWorkspacePortsEnabled}
						/>
					</div>
				)}
				{showWorkspaceAgents && (
					<div className="flex items-center justify-between gap-6">
						<div className="min-w-0 flex-1 space-y-0.5">
							<Label htmlFor="workspace-agents" className="text-sm font-medium">
								Workspace agents
							</Label>
							<p className="text-xs text-muted-foreground">
								Show running agents under each workspace in the sidebar, with
								their live status.
							</p>
						</div>
						<Switch
							id="workspace-agents"
							checked={workspaceAgentsEnabled}
							onCheckedChange={setWorkspaceAgentsEnabled}
						/>
					</div>
				)}
			</div>
		</div>
	);
}
