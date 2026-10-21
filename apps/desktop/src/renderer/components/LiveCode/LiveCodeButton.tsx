import type { RendererContext } from "@superset/panes";
import { Code2, MessageSquare } from "lucide-react";
import type { PaneViewerData } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/types";
import { toggleLiveCode, useLiveCodeState } from "./live-code-state";

export function LiveCodeButton({
	context,
}: {
	context: RendererContext<PaneViewerData>;
}) {
	const enabled = useLiveCodeState((s) => !!s.panes[context.pane.id]);
	return (
		<button
			type="button"
			className="gs-live-code-toggle"
			aria-label={enabled ? "Return to conversation" : "Watch live code"}
			title={enabled ? "Return to conversation" : "Watch live code"}
			aria-pressed={enabled}
			onClick={() => toggleLiveCode(context)}
		>
			{enabled ? <MessageSquare size={16} /> : <Code2 size={16} />}
		</button>
	);
}
