import {
	DndContext,
	PointerSensor,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import type { PaneRegistry, RendererContext } from "@superset/panes";
import { TooltipProvider } from "@superset/ui/tooltip";
import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { useStore } from "zustand";
import { ToolPanel } from "../../src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/components/WorkspaceToolPanels/components/ToolPanel/ToolPanel";
import { createToolPanels } from "../../src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/components/WorkspaceToolPanels/tool-panel-store";
import { BrowserPaneToolbar } from "../../src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/BrowserPane/BrowserPane";
import type { PaneViewerData } from "../../src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/types";
import { draculaTheme } from "../../src/shared/themes/built-in/dracula";
import { SplitPreviewFixture } from "./SplitPreviewFixture";
import "../../src/renderer/globals.css";
import "../../src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/components/WorkspaceToolPanels/tool-panels.css";

for (const [key, value] of Object.entries(draculaTheme.ui))
	if (typeof value === "string")
		document.documentElement.style.setProperty(
			`--${key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`,
			value,
		);
document.documentElement.classList.add("dark");
document.body.style.cssText =
	"margin:0;background:var(--background);color:var(--foreground);font-family:Inter,Segoe UI,sans-serif;padding:20px";
const tools = createToolPanels({
	key: "browser-chrome-fixture",
	createTerminal: async () => "fixture",
});
for (let index = 1; index <= 55; index++)
	tools.add("right", {
		id: `preview-${index}`,
		kind: "browser",
		titleOverride: `Project ${index}`,
		data: {
			url: `gatedspace-preview://${"a".repeat(32)}/`,
			pageTitle: `Project ${index}`,
			faviconUrl:
				index % 3 === 0
					? `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><rect width="20" height="20" rx="5" fill="#bd93f9"/><path d="M5 6h8v3H8v5H5z" fill="#282a36"/></svg>')}`
					: undefined,
		},
	});
const registry: PaneRegistry<PaneViewerData> = {
	browser: { getTitle: () => "Browser", renderPane: () => null },
};
function Preview() {
	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
	);
	useEffect(() => tools.connect(), []);
	const tabs = useStore(tools.store, (s) => s.tabs);
	const active = useStore(tools.state, (s) => s.right.activeTabId);
	const pane = Object.values(
		tabs.find((tab) => tab.id === active)?.panes ?? {},
	)[0];
	const ctx = pane
		? ({
				pane,
				tab: tabs.find((tab) => tab.id === active),
				actions: {
					updateData: (data: PaneViewerData) =>
						tools.store.getState().setPaneData({ paneId: pane.id, data }),
				},
				components: {
					PaneHeaderActions: () => <span data-duplicate-action>Duplicate</span>,
				},
			} as unknown as RendererContext<PaneViewerData>)
		: null;
	return (
		<TooltipProvider>
			<p
				style={{
					fontSize: 12,
					color: "var(--muted-foreground)",
					marginBottom: 16,
				}}
			>
				Browser refresh · Actual interface components with simulated pages.
				Scroll or close tabs to try the behavior.
			</p>
			<div
				data-browser-fixture
				style={{
					width: "min(720px, 100%)",
					height: 380,
					border: "1px solid var(--border)",
					borderRadius: 16,
					overflow: "hidden",
				}}
			>
				<DndContext sensors={sensors}>
					<ToolPanel
						side="right"
						tools={tools}
						tabs={tabs}
						registry={registry}
						activeTabId={active}
						open
					>
						{ctx && (
							<>
								<div
									style={{
										height: 44,
										flexShrink: 0,
										borderBottom: "1px solid var(--border)",
									}}
								>
									<BrowserPaneToolbar ctx={ctx} />
								</div>
								<div style={{ padding: 28 }}>
									<h2 style={{ fontSize: 18 }}>{pane.titleOverride}</h2>
									<p
										style={{
											marginTop: 12,
											color: "var(--muted-foreground)",
											fontSize: 13,
										}}
									>
										Your page fills this area. Page favicons and project title
										marks identify the tabs above.
									</p>
								</div>
							</>
						)}
					</ToolPanel>
				</DndContext>
			</div>
			<output id="browser-action" style={{ fontSize: 12 }} />
		</TooltipProvider>
	);
}
const root = document.createElement("main");
document.body.append(root);
createRoot(root).render(
	location.search.includes("split") ? <SplitPreviewFixture /> : <Preview />,
);
