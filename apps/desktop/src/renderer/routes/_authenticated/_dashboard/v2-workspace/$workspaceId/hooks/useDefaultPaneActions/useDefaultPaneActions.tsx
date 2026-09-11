import type { PaneActionConfig, RendererContext } from "@superset/panes";
import { toast } from "@superset/ui/sonner";
import { PanelBottom, PanelRight, Plus, X } from "lucide-react";
import { useMemo } from "react";
import { useStore } from "zustand";
import {
	panelButtonOwner,
	type ToolPanels,
} from "../../components/WorkspaceToolPanels/tool-panel-store";
import type { PaneViewerData } from "../../types";

export function useDefaultPaneActions({ tools }: { tools: ToolPanels }) {
	const rightOpen = useStore(tools.state, (s) => s.right.open);
	const bottomOpen = useStore(tools.state, (s) => s.bottom.open);
	return useMemo(
		() =>
			(
				ctx: RendererContext<PaneViewerData>,
			): PaneActionConfig<PaneViewerData>[] => {
				const owner =
					ctx.tab.maximizedPaneId ?? panelButtonOwner(ctx.tab.layout);
				const toggle = (side: "right" | "bottom") =>
					void tools
						.toggle(side)
						.catch((error) =>
							toast.error(
								error instanceof Error ? error.message : "Could not open panel",
							),
						);
				return [
					{
						key: "add-pane",
						label: "New pane",
						tooltip: "New pane",
						placement: "title",
						icon: <Plus className="size-4" />,
						onClick: (c) =>
							c.actions.split(
								c.pane.parentDirection === "horizontal" ? "down" : "right",
								{ kind: "new-tab", data: {} },
							),
					},
					...(ctx.pane.id === owner
						? [
								{
									key: "bottom-panel",
									label: "Toggle bottom panel",
									icon: <PanelBottom className="size-4" />,
									tooltip: "Toggle bottom panel",
									pressed: bottomOpen,
									onClick: () => toggle("bottom"),
								},
								{
									key: "right-panel",
									label: "Toggle right panel",
									icon: <PanelRight className="size-4" />,
									tooltip: "Toggle right panel",
									pressed: rightOpen,
									onClick: () => toggle("right"),
								},
							]
						: []),
					{
						key: "close",
						label: "Close pane",
						icon: <X className="size-4" />,
						tooltip: "Close pane",
						onClick: (c) => c.actions.close(),
					},
				];
			},
		[tools, rightOpen, bottomOpen],
	);
}
