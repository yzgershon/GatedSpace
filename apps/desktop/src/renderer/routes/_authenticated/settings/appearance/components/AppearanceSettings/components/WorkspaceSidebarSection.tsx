import { Switch } from "@superset/ui/switch";
import { useWorkspaceRecency } from "renderer/stores/workspace-recency";

export function WorkspaceSidebarSection() {
	const recentFirst = useWorkspaceRecency((state) => state.recentFirst);
	const setRecentFirst = useWorkspaceRecency((state) => state.setRecentFirst);
	return (
		<div className="flex items-start justify-between gap-6">
			<div className="min-w-0">
				<label htmlFor="workspace-recent-first" className="font-medium text-sm">
					Most recently used workspace first
				</label>
				<p className="mt-1 text-muted-foreground text-sm">
					Keep your latest workspace at the top. Pinned projects stay first.
					Turn this off to drag workspaces into your own order.
				</p>
			</div>
			<Switch
				id="workspace-recent-first"
				className="mt-1 shrink-0"
				checked={recentFirst}
				onCheckedChange={setRecentFirst}
			/>
		</div>
	);
}
